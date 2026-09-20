import type { DomainEvent } from '@orthacms/database';
import { WorkspaceId } from './value-objects/workspace-id';
import { Slug } from './value-objects/slug';
import { WorkspaceColor } from './value-objects/workspace-color';
import { WorkspaceStatus } from './value-objects/workspace-status';
import { Membership } from './membership';
import { ContentGrant, type ContentGrantKind } from './content-grant';
import {
    WORKSPACE_EVENT_KINDS,
    workspaceEvent
} from './events/workspace-events';
import {
    ContentTypeNotEmptyError,
    LastMemberError,
    WorkspaceNotEmptyError
} from './errors';

/** Fields a profile edit may change. Absent fields are left untouched. */
export interface WorkspaceProfilePatch {
    /** New display name. */
    name?: string;
    /** New long description (an empty string clears it). */
    description?: string;
    /** New accent color. */
    color?: WorkspaceColor;
}

/** The persistence deltas a {@link Workspace} accumulated since it was loaded. */
export interface WorkspaceChanges {
    /** Whether this is a brand-new aggregate (insert vs. update). */
    isNew: boolean;
    /** Whether name / description / color changed. */
    profileChanged: boolean;
    /** Whether the lifecycle status changed. */
    statusChanged: boolean;
    /** Member user ids added since load. */
    addedMemberIds: string[];
    /** Member user ids removed since load. */
    removedMemberIds: string[];
    /** Content grants added since load. */
    addedGrants: { kind: ContentGrantKind; slug: string }[];
    /** Content-grant slugs removed since load. */
    removedGrantSlugs: string[];
}

/** State the repository hands {@link Workspace.rehydrate} to reconstruct one. */
export interface WorkspaceState {
    id: string;
    name: string;
    slug: string;
    description: string;
    color: string;
    status: string;
    memberUserIds: string[];
    grants: { kind: ContentGrantKind; slug: string }[];
}

/**
 * The **workspaces** aggregate root — a tenancy boundary owning its
 * {@link Membership} links and {@link ContentGrant}s. Every state change goes
 * through a method here that enforces the context's invariants and raises a
 * domain event; the application layer then persists the aggregate and drains
 * its events to the outbox.
 *
 * The invariants this root guards:
 * - **slug format** (via the {@link Slug} value object on construction);
 * - **no orphaned content** — a workspace can't be deleted while it holds
 *   content entries ({@link assertDeletable}), and a content grant can't be
 *   revoked while that type still has entries ({@link revokeContent}); the entry
 *   counts come from the content context (a port), so the application supplies
 *   them and the root decides.
 *
 * Every mutator is **idempotent** and returns whether it actually changed
 * anything, so the application records an audit event only on a real change —
 * matching the transaction-script behavior this replaced.
 *
 * Framework-free: this file imports nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or the infrastructure layer (ADR-0003's one hard rule).
 */
export class Workspace {
    private readonly events: DomainEvent[] = [];

    private _isNew = false;
    private _profileChanged = false;
    private _statusChanged = false;
    private readonly _addedMemberIds: string[] = [];
    private readonly _removedMemberIds: string[] = [];
    private readonly _addedGrants: { kind: ContentGrantKind; slug: string }[] =
        [];
    private readonly _removedGrantSlugs: string[] = [];

    private constructor(
        private readonly _id: WorkspaceId,
        private _name: string,
        private readonly _slug: Slug,
        private _description: string,
        private _color: WorkspaceColor,
        private _status: WorkspaceStatus,
        private readonly _members: Membership[],
        private readonly _grants: ContentGrant[]
    ) {}

    /**
     * Creates a brand-new workspace owned by `creatorUserId` (linked as its
     * first member), with the given additional members and content grants.
     * Membership carries no role — the creator is simply the first link. Raises
     * `workspace.created`.
     */
    static create(props: {
        name: string;
        slug: Slug;
        description: string;
        color: WorkspaceColor;
        creatorUserId: string;
        memberUserIds: string[];
        grants: { kind: ContentGrantKind; slug: string }[];
    }): Workspace {
        const id = WorkspaceId.generate();
        const memberIds = dedupe([props.creatorUserId, ...props.memberUserIds]);
        const workspace = new Workspace(
            id,
            props.name,
            props.slug,
            props.description,
            props.color,
            WorkspaceStatus.active(),
            memberIds.map((userId) => Membership.create(userId)),
            props.grants.map((grant) =>
                ContentGrant.create(grant.kind, grant.slug)
            )
        );
        workspace._isNew = true;
        workspace._addedMemberIds.push(...memberIds);
        workspace._addedGrants.push(...props.grants);
        workspace.raise(WORKSPACE_EVENT_KINDS.CREATED, {
            name: props.name,
            slug: props.slug.value
        });
        return workspace;
    }

    /**
     * Reconstructs an existing workspace from persisted {@link WorkspaceState}.
     * Carries no pending changes and raises no events — it is the loaded
     * baseline the mutators diff against.
     */
    static rehydrate(state: WorkspaceState): Workspace {
        return new Workspace(
            WorkspaceId.create(state.id),
            state.name,
            Slug.create(state.slug),
            state.description,
            WorkspaceColor.create(state.color),
            WorkspaceStatus.create(state.status),
            state.memberUserIds.map((userId) => Membership.create(userId)),
            state.grants.map((grant) =>
                ContentGrant.create(grant.kind, grant.slug)
            )
        );
    }

    /**
     * Applies a partial profile edit (name / description / color). A patch with
     * no fields present is a no-op that returns `false` and records nothing;
     * otherwise raises `workspace.updated` carrying the changed field names.
     */
    updateProfile(patch: WorkspaceProfilePatch): boolean {
        const fields: string[] = [];
        if (patch.name !== undefined) {
            this._name = patch.name;
            fields.push('name');
        }
        if (patch.description !== undefined) {
            this._description = patch.description;
            fields.push('description');
        }
        if (patch.color !== undefined) {
            this._color = patch.color;
            fields.push('color');
        }
        if (fields.length === 0) {
            return false;
        }
        this._profileChanged = true;
        this.raise(WORKSPACE_EVENT_KINDS.UPDATED, { fields });
        return true;
    }

    /**
     * Sets the lifecycle status (archive / unarchive). A no-op when the status
     * already matches (returns `false`); otherwise raises `workspace.archived`
     * or `workspace.unarchived`.
     */
    setStatus(status: WorkspaceStatus): boolean {
        if (this._status.equals(status)) {
            return false;
        }
        this._status = status;
        this._statusChanged = true;
        this.raise(
            status.isArchived
                ? WORKSPACE_EVENT_KINDS.ARCHIVED
                : WORKSPACE_EVENT_KINDS.UNARCHIVED,
            {}
        );
        return true;
    }

    /**
     * Links `userId` as a member. Idempotent — re-adding an existing member is
     * a no-op that returns `false`; otherwise raises `workspace.member_added`.
     */
    addMember(userId: string): boolean {
        if (this.hasMember(userId)) {
            return false;
        }
        this._members.push(Membership.create(userId));
        this._addedMemberIds.push(userId);
        this.raise(WORKSPACE_EVENT_KINDS.MEMBER_ADDED, { userId });
        return true;
    }

    /**
     * Removes `userId`'s membership. Removing a non-member is a no-op that
     * returns `false`; otherwise raises `workspace.member_removed`.
     *
     * Throws {@link LastMemberError} rather than removing the final member:
     * access is membership-scoped, so a memberless workspace is unreachable by
     * everyone — including a global admin — with no route back to it. The rule
     * lives here, on the aggregate, so no caller can skip it.
     */
    removeMember(userId: string): boolean {
        const index = this._members.findIndex(
            (member) => member.userId === userId
        );
        if (index === -1) {
            return false;
        }
        if (this._members.length === 1) {
            throw new LastMemberError(this.id.value, userId);
        }
        this._members.splice(index, 1);
        this._removedMemberIds.push(userId);
        this.raise(WORKSPACE_EVENT_KINDS.MEMBER_REMOVED, { userId });
        return true;
    }

    /**
     * Grants access to one content type. Idempotent — re-granting is a no-op
     * that returns `false`; otherwise raises `workspace.content_granted`.
     */
    grantContent(kind: ContentGrantKind, slug: string): boolean {
        if (this.hasGrant(slug)) {
            return false;
        }
        this._grants.push(ContentGrant.create(kind, slug));
        this._addedGrants.push({ kind, slug });
        this.raise(WORKSPACE_EVENT_KINDS.CONTENT_GRANTED, { slug, kind });
        return true;
    }

    /**
     * Revokes a content grant — **only when the type holds no entries in this
     * workspace**, so a revoke never orphans reachable records. `entryCount`
     * comes from the content context (a port); a non-zero count throws
     * {@link ContentTypeNotEmptyError}. Revoking a grant the workspace never
     * held is a no-op that returns `false`; otherwise raises
     * `workspace.content_revoked`.
     */
    revokeContent(slug: string, entryCount: number): boolean {
        if (entryCount > 0) {
            throw new ContentTypeNotEmptyError(
                this._id.value,
                slug,
                entryCount
            );
        }
        const index = this._grants.findIndex((grant) => grant.slug === slug);
        if (index === -1) {
            return false;
        }
        this._grants.splice(index, 1);
        this._removedGrantSlugs.push(slug);
        this.raise(WORKSPACE_EVENT_KINDS.CONTENT_REVOKED, { slug });
        return true;
    }

    /**
     * Guards deletion: refuses with {@link WorkspaceNotEmptyError} while the
     * workspace still holds any content **entries** (`entryCount` from the
     * content context), so a delete never orphans records. Deletion itself is a
     * repository concern; this only enforces the invariant. Raises
     * `workspace.deleted`.
     */
    assertDeletable(entryCount: number): void {
        if (entryCount > 0) {
            throw new WorkspaceNotEmptyError(this._id.value, entryCount);
        }
        this.raise(WORKSPACE_EVENT_KINDS.DELETED, {
            name: this._name,
            slug: this._slug.value
        });
    }

    /** Drains and returns the events raised since the last pull. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }

    /** The persistence deltas the repository applies on save. */
    changes(): WorkspaceChanges {
        return {
            isNew: this._isNew,
            profileChanged: this._profileChanged,
            statusChanged: this._statusChanged,
            addedMemberIds: [...this._addedMemberIds],
            removedMemberIds: [...this._removedMemberIds],
            addedGrants: [...this._addedGrants],
            removedGrantSlugs: [...this._removedGrantSlugs]
        };
    }

    /** The workspace id. */
    get id(): WorkspaceId {
        return this._id;
    }

    /** The display name. */
    get name(): string {
        return this._name;
    }

    /** The URL slug. */
    get slug(): Slug {
        return this._slug;
    }

    /** The long description (empty string when unset). */
    get description(): string {
        return this._description;
    }

    /** The accent color. */
    get color(): WorkspaceColor {
        return this._color;
    }

    /** The lifecycle status. */
    get status(): WorkspaceStatus {
        return this._status;
    }

    private hasMember(userId: string): boolean {
        return this._members.some((member) => member.userId === userId);
    }

    private hasGrant(slug: string): boolean {
        return this._grants.some((grant) => grant.slug === slug);
    }

    private raise(kind: string, payload: Record<string, unknown>): void {
        this.events.push(workspaceEvent(kind, this._id.value, payload));
    }
}

/** Preserves first-seen order while dropping duplicate ids. */
function dedupe(ids: string[]): string[] {
    return [...new Set(ids)];
}
