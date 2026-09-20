import type { DomainEvent } from '@orthacms/database';
import { MemberId } from './value-objects/member-id';
import { Role } from './value-objects/role';
import { MemberStatus } from './value-objects/member-status';
import { MEMBER_EVENT_KINDS, memberEvent } from './events/member-events';
import { InvalidMemberStateError, LastAdminProtectedError } from './errors';

/** The persistence deltas a {@link Member} accumulated since it was loaded. */
export interface MemberChanges {
    /** Whether this is a brand-new aggregate (insert vs. update). */
    isNew: boolean;
    /** Whether the display name changed. */
    nameChanged: boolean;
    /** Whether the role changed. */
    roleChanged: boolean;
    /** Whether the lifecycle status changed. */
    statusChanged: boolean;
}

/** State the repository hands {@link Member.rehydrate} to reconstruct one. */
export interface MemberState {
    id: string;
    email: string;
    name: string | null;
    roleKey: string;
    status: string;
}

/**
 * The **member** aggregate root — a person who can authenticate, holding a
 * single global role and an account lifecycle status. It maps to identity's
 * `users` row; workspace memberships and invite tokens live in other contexts
 * and are orchestrated by the application layer, not owned here.
 *
 * Every state change goes through a method that enforces the context's
 * invariants and (for the primary transitions) raises a domain event; the
 * application then persists the aggregate and drains its events to the outbox.
 *
 * The invariants this root guards:
 * - **last-admin protection** — the last remaining *active admin* can be neither
 *   demoted ({@link changeRole}) nor disabled ({@link disable}); the current
 *   admin count comes from the repository (a port), so the application supplies
 *   it under a lock and the root decides — matching the transaction-script
 *   guard this replaced;
 * - **lifecycle validity** — only an `active` member can be disabled, only a
 *   `disabled` one enabled, and only a `pending` one resent/revoked.
 *
 * A member cannot act on **their own** account (self-disable / self-re-role);
 * that guard needs the acting user's identity, which the aggregate does not
 * know, so the application enforces it.
 *
 * Framework-free: this file imports nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or the infrastructure layer (ADR-0003's one hard rule).
 */
export class Member {
    private readonly events: DomainEvent[] = [];

    private _isNew = false;
    private _nameChanged = false;
    private _roleChanged = false;
    private _statusChanged = false;

    private constructor(
        private readonly _id: MemberId,
        private readonly _email: string,
        private _name: string | null,
        private _role: Role,
        private _status: MemberStatus
    ) {}

    /**
     * Creates a brand-new `pending` member for an invited email, holding the
     * given role. Mints its own id and raises `member.invited`. The invite token
     * and any workspace links are orchestrated by the application layer.
     */
    static invite(props: {
        email: string;
        name: string | null;
        role: Role;
    }): Member {
        const member = new Member(
            MemberId.generate(),
            props.email,
            props.name,
            props.role,
            MemberStatus.pending()
        );
        member._isNew = true;
        member.raise(MEMBER_EVENT_KINDS.INVITED, { email: props.email });
        return member;
    }

    /**
     * Reconstructs an existing member from persisted {@link MemberState}.
     * Carries no pending changes and raises no events — it is the loaded
     * baseline the mutators diff against.
     */
    static rehydrate(state: MemberState): Member {
        return new Member(
            MemberId.create(state.id),
            state.email,
            state.name,
            Role.create(state.roleKey),
            MemberStatus.create(state.status)
        );
    }

    /**
     * Renames the member. A no-op that returns `false` when the name is
     * unchanged; otherwise marks the change for persistence. Raises no domain
     * event (the application records the profile-update audit in-band).
     */
    rename(name: string): boolean {
        if (name === this._name) {
            return false;
        }
        this._name = name;
        this._nameChanged = true;
        return true;
    }

    /**
     * Changes the member's role. A no-op that returns `false` when the role is
     * unchanged. **Last-admin guard**: demoting the last remaining *active*
     * admin (`activeAdminCount <= 1`) throws {@link LastAdminProtectedError}.
     * Otherwise raises `member.role_changed` with the transition.
     *
     * `activeAdminCount` is supplied by the application under the active-admin
     * lock, so two concurrent demotions cannot both read a count above one.
     */
    changeRole(role: Role, activeAdminCount: number): boolean {
        if (this._role.equals(role)) {
            return false;
        }
        if (
            this._role.isAdmin &&
            !role.isAdmin &&
            this._status.isActive &&
            activeAdminCount <= 1
        ) {
            throw new LastAdminProtectedError(this._id.value);
        }
        const from = this._role.value;
        this._role = role;
        this._roleChanged = true;
        this.raise(MEMBER_EVENT_KINDS.ROLE_CHANGED, { from, to: role.value });
        return true;
    }

    /**
     * Disables an `active` member. Rejects a non-active member with
     * {@link InvalidMemberStateError} and disabling the last remaining active
     * admin with {@link LastAdminProtectedError} (checked in that order, under
     * the application's active-admin lock). Raises `member.disabled`.
     */
    disable(activeAdminCount: number): boolean {
        if (!this._status.isActive) {
            throw new InvalidMemberStateError(
                this._id.value,
                this._status.value,
                'disable'
            );
        }
        if (this._role.isAdmin && activeAdminCount <= 1) {
            throw new LastAdminProtectedError(this._id.value);
        }
        this._status = MemberStatus.disabled();
        this._statusChanged = true;
        this.raise(MEMBER_EVENT_KINDS.DISABLED, {});
        return true;
    }

    /**
     * Re-enables a `disabled` member. Rejects a non-disabled member with
     * {@link InvalidMemberStateError}. Raises no domain event (the application
     * records the reactivation audit in-band).
     */
    enable(): boolean {
        if (!this._status.isDisabled) {
            throw new InvalidMemberStateError(
                this._id.value,
                this._status.value,
                'enable'
            );
        }
        this._status = MemberStatus.active();
        this._statusChanged = true;
        return true;
    }

    /**
     * Guards resending an invite: only a `pending` member qualifies, else
     * {@link InvalidMemberStateError}. Rotating the token is a repository
     * concern; this only enforces the invariant and changes no state.
     */
    ensureCanResendInvite(): void {
        if (!this._status.isPending) {
            throw new InvalidMemberStateError(
                this._id.value,
                this._status.value,
                'resend an invite to'
            );
        }
    }

    /**
     * Guards issuing a password-reset link: only an `active` member qualifies,
     * else {@link InvalidMemberStateError}.
     *
     * A `pending` member has no password to reset — they finish through the
     * invite flow, and issuing a reset instead would hand them a link that
     * cannot activate their account. A `disabled` one is locked out on purpose;
     * minting a credential-setting link for them would quietly reopen a
     * sign-in path an admin deliberately closed (identity's redemption refuses
     * a non-active account for the same reason, so this only turns a dead link
     * into an honest 409).
     *
     * Minting the token is a repository concern; this only enforces the
     * invariant and changes no state.
     */
    ensureCanResetPassword(): void {
        if (!this._status.isActive) {
            throw new InvalidMemberStateError(
                this._id.value,
                this._status.value,
                'issue a password reset for'
            );
        }
    }

    /**
     * Revokes a `pending` member's invite, else {@link InvalidMemberStateError}
     * — real accounts are disabled, not deleted. The placeholder row's deletion
     * is a repository concern; this enforces the invariant and raises
     * `member.removed`.
     */
    revokeInvite(): void {
        if (!this._status.isPending) {
            throw new InvalidMemberStateError(
                this._id.value,
                this._status.value,
                'revoke an invite for'
            );
        }
        this.raise(MEMBER_EVENT_KINDS.REMOVED, { email: this._email });
    }

    /** Drains and returns the events raised since the last pull. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }

    /** The persistence deltas the repository applies on save. */
    changes(): MemberChanges {
        return {
            isNew: this._isNew,
            nameChanged: this._nameChanged,
            roleChanged: this._roleChanged,
            statusChanged: this._statusChanged
        };
    }

    /** The member id. */
    get id(): MemberId {
        return this._id;
    }

    /** The contact email (lower-cased). */
    get email(): string {
        return this._email;
    }

    /** The display name, or `null` until the member sets one. */
    get name(): string | null {
        return this._name;
    }

    /** The single global role. */
    get role(): Role {
        return this._role;
    }

    /** The account lifecycle status. */
    get status(): MemberStatus {
        return this._status;
    }

    private raise(kind: string, payload: Record<string, unknown>): void {
        this.events.push(memberEvent(kind, this._id.value, payload));
    }
}
