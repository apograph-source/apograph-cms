import type { DomainEvent } from '@orthacms/database';
import { UserId } from './value-objects/user-id';
import { Email } from './value-objects/email';
import { PasswordHash } from './value-objects/password-hash';
import { UserAccountStatus } from './value-objects/user-account-status';
import { IDENTITY_EVENT_KINDS, identityEvent } from './events/identity-events';
import { InvalidUserStateError } from './errors';

/** The persistence deltas a {@link UserAccount} accumulated since it loaded. */
export interface UserAccountChanges {
    /** Whether the lifecycle status changed. */
    statusChanged: boolean;
    /** Whether the password hash changed. */
    credentialChanged: boolean;
}

/** State the repository hands {@link UserAccount.rehydrate} to reconstruct one. */
export interface UserAccountState {
    id: string;
    email: string;
    status: string;
    /** The stored bcrypt hash, or `null` for a `pending` (un-accepted) invite. */
    passwordHash: string | null;
}

/**
 * The **user account** aggregate root — a person who can authenticate, holding
 * an email, an account lifecycle status, and (once an invite is accepted) a
 * password credential. It maps to identity's `users` row; the person's single
 * global role, workspace memberships, and sessions live under other
 * responsibilities and are not owned here.
 *
 * Every state change goes through a method that enforces the context's
 * invariants and raises a `user.*` domain event; the application persists the
 * aggregate and drains its events to the outbox.
 *
 * The invariants this root guards:
 * - **lifecycle validity** — only a `pending` account can be activated, only an
 *   `active` one disabled, only a `disabled` one enabled
 *   ({@link InvalidUserStateError});
 * - **credential presence** — activation sets the credential in the same step,
 *   and a `disabled` account cannot have its credential changed.
 *
 * Cross-account rules (e.g. last-admin protection) and self-action guards need
 * knowledge the aggregate does not hold (the admin count, the acting user), so
 * they are enforced by the application — the users context owns those flows.
 *
 * Framework-free: this file imports nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or the infrastructure layer (ADR-0003's one hard rule).
 */
export class UserAccount {
    private readonly events: DomainEvent[] = [];

    private _statusChanged = false;
    private _credentialChanged = false;

    private constructor(
        private readonly _id: UserId,
        private readonly _email: Email,
        private _status: UserAccountStatus,
        private _passwordHash: PasswordHash | null
    ) {}

    /**
     * Reconstructs an existing account from persisted {@link UserAccountState}.
     * Carries no pending changes and raises no events — the loaded baseline the
     * mutators diff against.
     */
    static rehydrate(state: UserAccountState): UserAccount {
        return new UserAccount(
            UserId.create(state.id),
            Email.create(state.email),
            UserAccountStatus.create(state.status),
            state.passwordHash === null
                ? null
                : PasswordHash.create(state.passwordHash)
        );
    }

    /**
     * Accepts an invite: activates a `pending` account and sets its first
     * credential in one step. Rejects a non-pending account with
     * {@link InvalidUserStateError}. Raises `user.activated`.
     */
    activate(passwordHash: PasswordHash): void {
        this.transitionToActive();
        this._passwordHash = passwordHash;
        this._credentialChanged = true;
        this.raise(IDENTITY_EVENT_KINDS.USER_ACTIVATED);
    }

    /**
     * Accepts an invite **without** setting a credential — the account is
     * activated by an identity provider vouching for its address instead.
     *
     * The absent password hash is the point rather than an omission: the
     * account has no credential of its own, so the password path refuses it
     * exactly as it refuses an unaccepted invite, and the only way in is the
     * provider that vouched for it. Should the person ever need a password, the
     * ordinary reset flow is what gives them one.
     *
     * Rejects a non-pending account with {@link InvalidUserStateError}. Raises
     * `user.activated`, the same fact the credentialled path raises: what
     * changed about the *account* is identical, and the difference in how it
     * happened rides on the sign-in event beside it.
     */
    activateWithoutCredential(): void {
        this.transitionToActive();
        this.raise(IDENTITY_EVENT_KINDS.USER_ACTIVATED);
    }

    /** The half both activation paths share: `pending` → `active`. */
    private transitionToActive(): void {
        if (!this._status.isPending) {
            throw new InvalidUserStateError(
                this._id.value,
                this._status.value,
                'activate'
            );
        }
        this._status = UserAccountStatus.active();
        this._statusChanged = true;
    }

    /**
     * Disables an `active` account. Rejects a non-active account with
     * {@link InvalidUserStateError}. Raises `user.disabled`. Cross-account
     * last-admin protection is the application's concern, not the aggregate's.
     */
    disable(): void {
        if (!this._status.isActive) {
            throw new InvalidUserStateError(
                this._id.value,
                this._status.value,
                'disable'
            );
        }
        this._status = UserAccountStatus.disabled();
        this._statusChanged = true;
        this.raise(IDENTITY_EVENT_KINDS.USER_DISABLED);
    }

    /**
     * Re-enables a `disabled` account. Rejects a non-disabled account with
     * {@link InvalidUserStateError}. Raises `user.enabled`.
     */
    enable(): void {
        if (!this._status.isDisabled) {
            throw new InvalidUserStateError(
                this._id.value,
                this._status.value,
                'enable'
            );
        }
        this._status = UserAccountStatus.active();
        this._statusChanged = true;
        this.raise(IDENTITY_EVENT_KINDS.USER_ENABLED);
    }

    /**
     * Changes the credential of a non-disabled account (a password reset or
     * self-service change). Rejects a `disabled` account with
     * {@link InvalidUserStateError} — a locked-out account is reset by first
     * re-enabling it. Raises `user.password_changed`.
     */
    changeCredential(passwordHash: PasswordHash): void {
        if (this._status.isDisabled) {
            throw new InvalidUserStateError(
                this._id.value,
                this._status.value,
                'change the credential of'
            );
        }
        this._passwordHash = passwordHash;
        this._credentialChanged = true;
        this.raise(IDENTITY_EVENT_KINDS.PASSWORD_CHANGED);
    }

    /** Drains and returns the events raised since the last pull. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }

    /** The persistence deltas the repository applies on save. */
    changes(): UserAccountChanges {
        return {
            statusChanged: this._statusChanged,
            credentialChanged: this._credentialChanged
        };
    }

    /** The account id. */
    get id(): UserId {
        return this._id;
    }

    /** The login email (lower-cased). */
    get email(): Email {
        return this._email;
    }

    /** The account lifecycle status. */
    get status(): UserAccountStatus {
        return this._status;
    }

    /** The stored credential, or `null` for a `pending` account. */
    get passwordHash(): PasswordHash | null {
        return this._passwordHash;
    }

    private raise(kind: string): void {
        this.events.push(identityEvent(kind, this._id.value));
    }
}
