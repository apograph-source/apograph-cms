import type {
    AnyContentType,
    ContentGrantsSource,
    ContentTypeRegistry,
    PublicApiToken,
    PublicEntriesQuery,
    PublicEntryWritesService
} from '@orthacms/content-server';
import type { PermissionKey } from '@orthacms/identity-server';
import type { ContentGraphqlLimits } from '../types/config';
import type { EntryLoader } from './entry-loader';

/**
 * Everything a resolver needs, assembled once per request by the controller.
 *
 * Resolvers reach for their collaborators **through the context** rather than
 * closing over injected services, which is what lets a built schema be cached
 * and shared across requests: the schema describes the shape, the context
 * carries the caller. It also keeps `schema/` and `resolvers/` free of NestJS —
 * everything below is a plain object, so the whole layer is unit-testable
 * without standing up a module.
 */
export interface GraphqlContext {
    /**
     * The workspace this request acts in, already resolved by
     * `ApiTokenWorkspaceGuard` from `X-Workspace-Id` (or from the token's bucket
     * when it holds exactly one).
     */
    workspaceId: string;
    /** The verified bearer token, as the guard attached it. */
    token: PublicApiToken;
    /** The code-defined content types. */
    registry: ContentTypeRegistry;
    /**
     * The workspace's content grants, read once for this request. The schema was
     * built from this same set, so introspection and resolution agree.
     */
    grants: ContentGrantsSource;
    /** The published-only read path — the same one `/v1/content` serves from. */
    entries: PublicEntriesQuery;
    /** The write path — the same one `/v1/content` writes through. */
    writes: PublicEntryWritesService;
    /** Batches the per-level entry loads a nested query provokes. */
    loader: EntryLoader;
    /** The operation's cost budget, for resolvers that clamp a page size. */
    limits: ContentGraphqlLimits;
    /**
     * Whether the token's scope grants `permission` — the same decision
     * `AccessPolicy` makes for a session, via `tokenActor`.
     */
    can(permission: PermissionKey): boolean;
    /**
     * Throws a `ForbiddenException` unless the token's scope grants
     * `permission`. The per-field replacement for a route's
     * `@RequirePermissions(...)`, which cannot decide for a single endpoint
     * serving reads and writes at once.
     */
    assert(permission: PermissionKey): void;
}

/** A content type resolved for this request, with the grant set that admitted it. */
export interface ResolvedType {
    type: AnyContentType;
    granted: ReadonlySet<string>;
}
