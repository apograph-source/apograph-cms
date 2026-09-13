import type { INestApplication } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { Pool } from 'pg';
import { getDatabase, getPool } from '@apograph/database';
import {
    RootAdminService,
    apiTokens,
    permissions as permissionsTable,
    rolePermissions,
    roles,
    sessions,
    tokens,
    users,
    type RootAdminOutcome
} from '@apograph/identity-server';
import {
    memberships,
    workspaceContent,
    workspaces
} from '@apograph/workspaces-server';
import { mediaAsset, mediaFolder } from '@apograph/media-server';
// The e2e-owned generated content tables (from the harness's own content model,
// NOT the app's collections). Specs reach these only through the helpers below.
import {
    testArticleTags,
    testArticles,
    testAuthors,
    testContentTypes,
    testLandingPage,
    testPages,
    testTags
} from './content';
// HashingService is internal to the identity plugin (not re-exported). We reach
// for the class to pull the SAME provider instance out of the DI container, so
// seeded password hashes are produced by the exact code login verifies against
// — no re-implemented bcrypt to drift.
import { HashingService } from '../../../../packages/identity/server/src/lib/auth/services/hashing.service';
import { withDatabaseDiagnostics } from './infra-error';
import { resetBlobStore } from './media-storage';
import { resolveDatabaseUrl } from './db-url';

/** A system role key seeded by `SystemRolesSeeder` at app boot. */
export type SystemRoleKey = 'admin' | 'contributor' | 'viewer';

/** Account lifecycle status; only `active` may log in. */
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface SeededUser {
    id: string;
    email: string;
}

/** Look up a seeded role id by its key (e.g. 'admin'). */
async function roleIdByKey(key: SystemRoleKey): Promise<string> {
    const db = getDatabase();
    const [role] = await db.select().from(roles).where(eq(roles.key, key));
    if (!role) {
        throw new Error(
            `Role "${key}" not found — are the system roles seeded?`
        );
    }
    return role.id;
}

/**
 * Insert a user with full control over status and password. When `password`
 * is omitted the row is stored with a `null` hash (the invite-pending state),
 * exercising the "no credential set" login path. Hashing goes through the
 * app's real `HashingService`.
 */
export async function seedUser(
    app: INestApplication,
    opts: {
        email: string;
        password?: string;
        role: SystemRoleKey;
        status?: UserStatus;
        name?: string;
    }
): Promise<SeededUser> {
    const passwordHash = opts.password
        ? await app.get(HashingService).hashPassword(opts.password)
        : null;
    const roleId = await roleIdByKey(opts.role);

    const [user] = await insertSeedUser({
        email: opts.email,
        name: opts.name ?? null,
        passwordHash,
        roleId,
        status: opts.status ?? 'active'
    });

    return { id: user.id, email: user.email };
}

/**
 * The insert, with the one failure it has been observed to produce explained.
 *
 * `resetDb` truncates `users` before every test, so a duplicate email here is
 * never the test's own doing — the row was written by something outside this
 * test's sequence. In practice that is an **abandoned hook**: Jest reports a
 * hook that overruns `testTimeout` and moves on, but it does not cancel the
 * promise, so the rest of that hook keeps running and its insert lands after
 * the *next* test's `resetDb` has already truncated. The next test then dies on
 * a unique violation while doing nothing wrong, and the report blames it.
 *
 * The stall is what to fix (see {@link truncateWithBoundedLockWait}, which
 * removes the known cause of one). This exists so that if a hook is ever
 * abandoned for some other reason, the second failure says which test to look
 * at instead of reading as a data-integrity bug.
 */
async function insertSeedUser(values: {
    email: string;
    name: string | null;
    passwordHash: string | null;
    roleId: string;
    status: UserStatus;
}) {
    try {
        return await getDatabase().insert(users).values(values).returning();
    } catch (error) {
        // Drizzle wraps the driver error, so the `constraint` field can be on
        // either level; the message is checked too because which of the three
        // is populated is a detail of a dependency, and getting this wrong
        // would swallow an unrelated failure.
        if (!isDuplicateEmail(error)) throw error;
        throw new Error(
            `[e2e] seedUser: "${values.email}" already exists, immediately after resetDb truncated \`users\`.\n\n` +
                'That row was written outside this test. The usual cause is a hook in an\n' +
                'EARLIER test that exceeded its timeout: Jest gives up on it and moves on, but\n' +
                "the work behind it keeps running, so that hook's insert lands after this\n" +
                "test's reset. This test is the victim, not the cause — look for the hook\n" +
                'timeout reported above it.',
            { cause: error }
        );
    }
}

/** The unique index on `lower(email)` that a re-seeded user collides with. */
const USERS_EMAIL_UNIQUE = 'users_email_lower_unique';

/** Whether a thrown error is that collision, however it is wrapped. */
export function isDuplicateEmail(error: unknown): boolean {
    for (let current = error, depth = 0; current && depth < 4; depth += 1) {
        const node = current as { constraint?: string; cause?: unknown };
        if (node.constraint === USERS_EMAIL_UNIQUE) return true;
        current = node.cause;
    }
    return error instanceof Error && error.message.includes(USERS_EMAIL_UNIQUE);
}

/** Convenience: an active user with valid credentials for `POST /auth/login`. */
export async function seedActiveUser(
    app: INestApplication,
    opts: {
        email: string;
        password: string;
        role: SystemRoleKey;
        name?: string;
    }
): Promise<SeededUser> {
    return seedUser(app, { ...opts, status: 'active' });
}

/**
 * Insert an active user under a freshly-created, **permission-less** role —
 * the principal that proves a route requires a specific permission rather than
 * mere authentication. `roleKey` need only be unique *within a test*: `resetDb`
 * deletes non-system roles, so the same key can be reused by the next test, by
 * a retry, and by another suite.
 */
export async function seedUserWithEmptyRole(
    app: INestApplication,
    opts: { email: string; password: string; roleKey: string }
): Promise<SeededUser> {
    const db = getDatabase();
    const [role] = await db
        .insert(roles)
        .values({ key: opts.roleKey, name: opts.roleKey, isSystem: false })
        .returning();
    const passwordHash = await app
        .get(HashingService)
        .hashPassword(opts.password);
    const [user] = await db
        .insert(users)
        .values({
            email: opts.email,
            passwordHash,
            roleId: role.id,
            status: 'active'
        })
        .returning();
    return { id: user.id, email: user.email };
}

/**
 * Insert an active user under a fresh role granted exactly `permissions`.
 *
 * The point is a principal who holds a capability **without** being an admin —
 * the only way to reach the last-admin guards, since an admin looking at the
 * sole remaining admin is looking at themselves and trips the self-action guard
 * first. `roleKey` need only be unique within a test — `resetDb` deletes
 * non-system roles.
 */
export async function seedUserWithPermissions(
    app: INestApplication,
    opts: {
        email: string;
        password: string;
        roleKey: string;
        permissions: string[];
    }
): Promise<SeededUser> {
    const db = getDatabase();
    const [role] = await db
        .insert(roles)
        .values({ key: opts.roleKey, name: opts.roleKey, isSystem: false })
        .returning();
    const rows = await db
        .select({ id: permissionsTable.id, key: permissionsTable.key })
        .from(permissionsTable);
    const wanted = rows.filter((row) => opts.permissions.includes(row.key));
    if (wanted.length !== opts.permissions.length) {
        throw new Error(
            `seedUserWithPermissions: unknown permission key in ${JSON.stringify(opts.permissions)}`
        );
    }
    await db
        .insert(rolePermissions)
        .values(wanted.map((p) => ({ roleId: role.id, permissionId: p.id })));
    const passwordHash = await app
        .get(HashingService)
        .hashPassword(opts.password);
    const [user] = await db
        .insert(users)
        .values({
            email: opts.email,
            passwordHash,
            roleId: role.id,
            status: 'active'
        })
        .returning();
    return { id: user.id, email: user.email };
}

/**
 * Take one permission away from a **non-system** role, mid-test.
 *
 * The point is a grant that changes *while something is running*: ADR-0005 §2
 * makes the copilot re-resolve a run's authority per call precisely because a
 * role can be edited during a long turn, and that rule is unfalsifiable unless
 * a test can perform the edit at the moment the run is parked.
 *
 * **System roles are refused.** `resetDb` deletes non-system roles and leaves
 * the seeded ones alone, so a `DELETE` against `admin` or `contributor` would
 * survive the reset and quietly de-authorize every later spec file in the run —
 * a wall of unrelated 403s attributed to whichever suite ran next. Pair this
 * with {@link seedUserWithPermissions}, whose role is disposable by
 * construction.
 */
export async function revokePermissionFromRole(
    roleKey: string,
    permissionKey: string
): Promise<void> {
    const db = getDatabase();
    const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
    if (!role) {
        throw new Error(`revokePermissionFromRole: no role "${roleKey}".`);
    }
    if (role.isSystem) {
        throw new Error(
            `revokePermissionFromRole: "${roleKey}" is a system role — ` +
                'the revocation would outlive `resetDb`. Seed a role with ' +
                '`seedUserWithPermissions` and revoke from that instead.'
        );
    }
    const [permission] = await db
        .select()
        .from(permissionsTable)
        .where(eq(permissionsTable.key, permissionKey));
    if (!permission) {
        throw new Error(
            `revokePermissionFromRole: no permission "${permissionKey}".`
        );
    }
    await db
        .delete(rolePermissions)
        .where(
            and(
                eq(rolePermissions.roleId, role.id),
                eq(rolePermissions.permissionId, permission.id)
            )
        );
}

/** A seeded workspace row — what the workspaces read assertions reference. */
export interface SeededWorkspace {
    id: string;
    name: string;
    slug: string;
    color: string;
}

/**
 * Insert a workspace row directly. `description` defaults to `null`; `color`
 * is omitted so the schema default (`slate`) applies unless overridden.
 */
export async function seedWorkspace(opts: {
    name: string;
    slug: string;
    description?: string;
    color?: string;
}): Promise<SeededWorkspace> {
    const [workspace] = await getDatabase()
        .insert(workspaces)
        .values({
            name: opts.name,
            slug: opts.slug,
            description: opts.description ?? null,
            ...(opts.color ? { color: opts.color } : {})
        })
        .returning();
    return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        color: workspace.color
    };
}

/**
 * Archive a workspace directly. The API route needs membership plus an
 * `Origin` header, which is noise for a spec that only cares that an archived
 * workspace still **exists** — the distinction the API-token bucket check draws.
 */
export async function archiveWorkspace(workspaceId: string): Promise<void> {
    await getDatabase()
        .update(workspaces)
        .set({ status: 'archived' })
        .where(eq(workspaces.id, workspaceId));
}

/**
 * Grant a workspace access to content slugs (the `workspace_content` rows the
 * create wizard writes). Membership alone is not access: the filter-fields
 * surface 404s a type the workspace was never granted, and prunes relations
 * into ungranted targets, so a spec that asserts on the surface has to seed
 * the grants its assertions assume.
 */
export async function seedContentGrants(
    workspaceId: string,
    slugs: readonly string[],
    kind: 'collection' | 'single' = 'collection'
): Promise<void> {
    if (slugs.length === 0) return;
    await getDatabase()
        .insert(workspaceContent)
        .values(slugs.map((slug) => ({ workspaceId, kind, slug })));
}

/**
 * Grant a workspace **every** harness-registered content type, each with its
 * real kind.
 *
 * The default for any spec whose subject isn't the grant rule itself: since
 * `ContentGrantGuard` landed, a workspace reaches only the types it was granted
 * — `/api/content/:typeName` and `/api/content-schema/:name` answer `404` for
 * the rest — so a spec that seeds a bare workspace and then posts an entry is
 * testing an empty grant set, not the endpoint it named. Grant-scoping specs
 * call {@link seedContentGrants} with an explicit list instead.
 */
export async function seedAllContentGrants(workspaceId: string): Promise<void> {
    await getDatabase()
        .insert(workspaceContent)
        .values(
            testContentTypes.map((type) => ({
                workspaceId,
                kind: type.kind,
                slug: type.name
            }))
        );
}

/**
 * Revoke every content grant a workspace holds.
 *
 * The API refuses a revoke while entries of that type still exist, so a spec
 * that wants the *post*-revoke state (a workspace that has content but no
 * longer has the grant) has to write it directly — which is also the state a
 * revoke performed between two deployments leaves behind.
 */
export async function revokeContentGrants(workspaceId: string): Promise<void> {
    await getDatabase()
        .delete(workspaceContent)
        .where(eq(workspaceContent.workspaceId, workspaceId));
}

/** Add a user to a workspace (the `memberships` join). */
export async function seedMembership(
    userId: string,
    workspaceId: string
): Promise<void> {
    await getDatabase().insert(memberships).values({ userId, workspaceId });
}

/** The workspace ids a user belongs to — for asserting membership side effects. */
export async function getWorkspaceIdsForUser(
    userId: string
): Promise<string[]> {
    const rows = await getDatabase()
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .where(eq(memberships.userId, userId));
    return rows.map((row) => row.workspaceId);
}

/** Force every session of a user into the past — simulates natural expiry. */
export async function expireUserSessions(userId: string): Promise<void> {
    await getDatabase()
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(sessions.userId, userId));
}

/**
 * Back-date an API token's expiry — the out-of-band move the management API
 * refuses to make (it rejects an `expiresAt` in the past), so an expired token
 * can only be reached by editing the row. Mirrors {@link expireUserSessions}.
 */
export async function expireApiToken(tokenId: string): Promise<void> {
    await getDatabase()
        .update(apiTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(apiTokens.id, tokenId));
}

/** One session row's timing columns, for the refresh-throttle assertions. */
export interface SessionTiming {
    id: string;
    lastUsedAt: Date;
    expiresAt: Date;
}

/** A user's session rows, newest-used first. */
export async function getUserSessions(
    userId: string
): Promise<SessionTiming[]> {
    return getDatabase()
        .select({
            id: sessions.id,
            lastUsedAt: sessions.lastUsedAt,
            expiresAt: sessions.expiresAt
        })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.lastUsedAt));
}

/**
 * Push a user's `last_used_at` `ms` milliseconds into the past. The refresh is
 * throttled to one write a minute, so a spec that wants to observe the refresh
 * back-dates the column instead of sleeping out the real window.
 */
export async function backdateSessionLastUsed(
    userId: string,
    ms: number
): Promise<void> {
    await getDatabase()
        .update(sessions)
        .set({ lastUsedAt: new Date(Date.now() - ms) })
        .where(eq(sessions.userId, userId));
}

/**
 * Set a user's session expiry to **exactly now**. The validity predicate is a
 * strict `expires_at > now()`, so the instant of expiry is already invalid —
 * the boundary this exists to pin down.
 */
export async function expireUserSessionsAt(
    userId: string,
    at: Date = new Date()
): Promise<void> {
    await getDatabase()
        .update(sessions)
        .set({ expiresAt: at })
        .where(eq(sessions.userId, userId));
}

/** Whether any row of `sessions` stores `token` verbatim (it must not). */
export async function sessionRowsContainToken(token: string): Promise<boolean> {
    const { rows } = await getPool().query(
        'SELECT count(*)::int AS total FROM sessions WHERE id = $1',
        [token]
    );
    return rows[0].total > 0;
}

/** An API token's stored hash — asserted to be a digest, never the secret. */
export async function getApiTokenHash(id: string): Promise<string | null> {
    const [row] = await getDatabase()
        .select({ tokenHash: apiTokens.tokenHash })
        .from(apiTokens)
        .where(eq(apiTokens.id, id));
    return row?.tokenHash ?? null;
}

/**
 * An API token's `last_used_at`, or `null` when it has never authenticated a
 * request.
 *
 * The column is written by a **throttled, fire-and-forget** touch inside
 * `ApiTokenService.verify`, so nothing on the authenticated response carries it
 * and the management list only shows it on a later call. A spec asserting the
 * throttle reads the column directly, the same way the session refresh specs
 * read {@link getUserSessions}.
 */
export async function getApiTokenLastUsed(id: string): Promise<Date | null> {
    const [row] = await getDatabase()
        .select({ lastUsedAt: apiTokens.lastUsedAt })
        .from(apiTokens)
        .where(eq(apiTokens.id, id));
    return row?.lastUsedAt ?? null;
}

/**
 * Push an API token's `last_used_at` `ms` milliseconds into the past. The touch
 * is throttled to one write a minute, so a spec that wants to observe the
 * *second* touch back-dates the column instead of sleeping out the real window.
 * Mirrors {@link backdateSessionLastUsed}.
 */
export async function backdateApiTokenLastUsed(
    id: string,
    ms: number
): Promise<void> {
    await getDatabase()
        .update(apiTokens)
        .set({ lastUsedAt: new Date(Date.now() - ms) })
        .where(eq(apiTokens.id, id));
}

/** Revoke every session of a user — simulates an explicit logout/kill. */
export async function revokeUserSessions(userId: string): Promise<void> {
    await getDatabase()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, userId));
}

/**
 * Flip a user's lifecycle status **without** touching their sessions — the
 * out-of-band suspension the API's own disable endpoint never performs (it
 * revokes in the same transaction). Lets a spec assert that a live cookie is
 * refused on account status alone.
 */
export async function setUserStatus(
    userId: string,
    status: UserStatus
): Promise<void> {
    await getDatabase()
        .update(users)
        .set({ status })
        .where(eq(users.id, userId));
}

/**
 * Change the address an account holds.
 *
 * The SSO suite needs it to prove the point of keying a link on the provider's
 * subject rather than on an email: move the address, and a subject-keyed link
 * still resolves while an email-keyed one would not.
 */
export async function setUserEmail(
    userId: string,
    email: string
): Promise<void> {
    await getDatabase()
        .update(users)
        .set({ email })
        .where(eq(users.id, userId));
}

/** Delete a user row (cascades to their sessions via FK). */
export async function deleteUser(userId: string): Promise<void> {
    await getDatabase().delete(users).where(eq(users.id, userId));
}

/** A user row joined to its role key — what root-admin assertions read. */
export interface UserRow {
    id: string;
    email: string;
    status: UserStatus;
    roleKey: string;
    passwordHash: string | null;
}

/** Look up a single user by (case-insensitive) email, with its role key. */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
    const [row] = await getDatabase()
        .select({
            id: users.id,
            email: users.email,
            status: users.status,
            roleKey: roles.key,
            passwordHash: users.passwordHash
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.email, email.trim().toLowerCase()));
    return row ?? null;
}

/**
 * A user's `updated_at`, or `null` when no such user exists.
 *
 * The column is `$onUpdate`-stamped, so it is the only outward difference
 * between a request that merely re-read the row and one that rewrote it. A
 * patch asking for the value a member already holds answers `200` either way,
 * and the response body is identical — the timestamp is what says whether an
 * UPDATE actually ran.
 */
export async function getUserUpdatedAt(userId: string): Promise<Date | null> {
    const [row] = await getDatabase()
        .select({ updatedAt: users.updatedAt })
        .from(users)
        .where(eq(users.id, userId));
    return row?.updatedAt ?? null;
}

/** Count user rows — used to assert the bootstrap inserts exactly one. */
export async function countUsers(): Promise<number> {
    const rows = await getDatabase().select({ id: users.id }).from(users);
    return rows.length;
}

/**
 * Drive the plugin's real `RootAdminService.ensure` (pulled from DI) against
 * the live test DB — it hashes through the app's `HashingService`, so the
 * stored hash is what login verifies. Lets specs assert the bootstrap's
 * idempotency and non-destructive behavior without re-importing internals.
 */
export async function provisionRootAdmin(
    app: INestApplication,
    opts: { email: string; password: string }
): Promise<RootAdminOutcome> {
    return app.get(RootAdminService).ensure(opts.email, opts.password);
}

/**
 * The live invite tokens for a user — `tokenHash`s only (the raw token is
 * never stored). Used to assert that inviting issues a token and that resend
 * rotates it (a different hash, still exactly one).
 */
export async function getInviteTokenHashes(userId: string): Promise<string[]> {
    const rows = await getDatabase()
        .select({ tokenHash: tokens.tokenHash, type: tokens.type })
        .from(tokens)
        .where(eq(tokens.userId, userId));
    return rows
        .filter((row) => row.type === 'invite')
        .map((row) => row.tokenHash);
}

/**
 * Back-date a user's invite token issue time — steps past the resend cooldown
 * without making the suite sleep for it. `POST /:id/invites/resend` refuses to
 * rotate a link minted moments ago (it would destroy one the admin is still
 * holding), so a spec that resends right after inviting has to age the token
 * first or assert the `INVITE_RECENTLY_SENT` conflict deliberately.
 */
export async function ageInviteTokens(
    userId: string,
    seconds = 3600
): Promise<void> {
    await getDatabase()
        .update(tokens)
        .set({ createdAt: new Date(Date.now() - seconds * 1000) })
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'invite')));
}

/**
 * Force a user's invite tokens into the past — simulates a link that sat in an
 * inbox past its TTL, without making the suite wait out the real one.
 */
export async function expireInviteTokens(userId: string): Promise<void> {
    await getDatabase()
        .update(tokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'invite')));
}

/**
 * Whether a user's invite token has been burned — `consumedAt` is what makes an
 * invite link one-time, so a spec asserting "the link is spent" reads it here.
 * `null` when the user has no invite token at all.
 */
export async function getInviteConsumedAt(
    userId: string
): Promise<Date | null | undefined> {
    const [row] = await getDatabase()
        .select({ consumedAt: tokens.consumedAt })
        .from(tokens)
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'invite')));
    return row?.consumedAt;
}

/**
 * Read a user's live password-reset token hashes — the raw token is returned by
 * the API exactly once and never stored. Used to assert that issuing mints a
 * token and that re-issuing rotates it (a different hash, still exactly one).
 */
export async function getResetTokenHashes(userId: string): Promise<string[]> {
    const rows = await getDatabase()
        .select({ tokenHash: tokens.tokenHash, type: tokens.type })
        .from(tokens)
        .where(eq(tokens.userId, userId));
    return rows
        .filter((row) => row.type === 'reset')
        .map((row) => row.tokenHash);
}

/**
 * Back-date a user's reset token issue time — steps past the issue cooldown
 * without making the suite sleep for it. `POST /:id/password-reset` refuses to
 * rotate a link minted moments ago (it would destroy one the admin is still
 * holding), so a spec that re-issues has to age the token first or assert the
 * `PASSWORD_RESET_RECENTLY_SENT` conflict deliberately.
 */
export async function ageResetTokens(
    userId: string,
    seconds = 3600
): Promise<void> {
    await getDatabase()
        .update(tokens)
        .set({ createdAt: new Date(Date.now() - seconds * 1000) })
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'reset')));
}

/**
 * Force a user's reset tokens into the past — simulates a link that sat unused
 * past its TTL, without making the suite wait out the real one.
 */
export async function expireResetTokens(userId: string): Promise<void> {
    await getDatabase()
        .update(tokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'reset')));
}

/**
 * Whether a user's reset token has been burned — `consumedAt` is what makes a
 * reset link one-time, so a spec asserting "the link is spent" reads it here.
 * `null` when the user has no reset token at all.
 */
export async function getResetConsumedAt(
    userId: string
): Promise<Date | null | undefined> {
    const [row] = await getDatabase()
        .select({ consumedAt: tokens.consumedAt })
        .from(tokens)
        .where(and(eq(tokens.userId, userId), eq(tokens.type, 'reset')));
    return row?.consumedAt;
}

/** Count a user's session rows — used to assert a session was created. */
export async function countUserSessions(userId: string): Promise<number> {
    const rows = await getDatabase()
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId));
    return rows.length;
}

/**
 * Count the sessions a user could still present — not revoked, not expired.
 *
 * Revocation is a soft one: `revoke` stamps `revoked_at` and leaves the row
 * where it is, so {@link countUserSessions} still sees it. That distinction is
 * the whole point when asserting that something *ended* a session rather than
 * that no session was ever opened, and counting rows conflates the two.
 */
export async function countLiveUserSessions(userId: string): Promise<number> {
    const rows = await getDatabase()
        .select({ id: sessions.id })
        .from(sessions)
        .where(
            and(
                eq(sessions.userId, userId),
                isNull(sessions.revokedAt),
                gt(sessions.expiresAt, new Date())
            )
        );
    return rows.length;
}

/** Read every audit event, newest first — what the activity assertions read. */
export async function getActivityRows(): Promise<
    {
        kind: string;
        subjectType: string;
        subjectId: string;
        actorId: string | null;
        actorEmail: string | null;
        meta: unknown;
    }[]
> {
    const { rows } = await getPool().query(
        `SELECT kind, subject_type AS "subjectType", subject_id AS "subjectId",
                actor_id AS "actorId", actor_email AS "actorEmail", meta
         FROM activity_events
         ORDER BY at DESC, id DESC`
    );
    return rows;
}

/** Count audit events — used to assert a rolled-back mutation writes none. */
export async function countActivityRows(): Promise<number> {
    const { rows } = await getPool().query(
        'SELECT count(*)::int AS total FROM activity_events'
    );
    return rows[0].total;
}

/**
 * Truncate the mutable tables between tests, leaving the seeded system roles
 * and permissions in place (users reference roles via FK). `CASCADE` clears
 * dependent rows — sessions, tokens, memberships — in one statement.
 * `activity_events` is truncated explicitly: its `actor_id` has no FK, so a
 * `users` cascade never reaches it. Every e2e content table is truncated too
 * (content has no FK to `workspaces`, so a workspace cascade never reaches it);
 * `CASCADE` on `content_test_article` also clears its join + comment children.
 * `content_entry_revisions` is truncated explicitly for the same reason as
 * `activity_events`: it keys entries by plain uuid with no FK, so no cascade
 * reaches it and every save's snapshot would otherwise outlive its test.
 *
 * `outbox_events` is likewise truncated explicitly, and it is the one that bit:
 * it declares no foreign keys at all, so nothing cascades to it. A row whose
 * subscriber threw stays `dispatched_at IS NULL`, and the dispatcher's 5-second
 * poll backstop retries it **inside a later test** — after this TRUNCATE has
 * removed the rows it refers to. The symptom is an `activity_events` count that
 * is one too high in a test that created nothing, with the explanatory log line
 * suppressed because `createTestApp` boots with `logger: false`.
 *
 * Non-system `roles` go too. System roles must survive (users FK them and the
 * bootstrap seeder only runs once per app), but `seedUserWithEmptyRole` /
 * `seedUserWithPermissions` insert *non-system* roles, and those surviving is
 * what made those helpers retry-hostile: a second attempt at the same test —
 * a `jest.retryTimes` policy, `--repeat-each`, or simply two tests in one file
 * using the same `roleKey` — died on a unique violation on `roles.key` rather
 * than on whatever it was actually asserting.
 */
export async function resetDb(): Promise<void> {
    await withDatabaseDiagnostics('resetting the test database', async () => {
        await truncateWithBoundedLockWait();
        // The bytes, too. `media_asset` is truncated above, so a surviving blob
        // is one no row names — able to satisfy a download for a `storage_key`
        // a later test happens to reproduce.
        resetBlobStore();
    });
}

/** The reset itself, as one transaction. See {@link truncateWithBoundedLockWait}. */
const RESET_SQL = [
    'TRUNCATE TABLE users, workspaces, activity_events, ' +
        'content_test_article, content_test_author, content_test_tag, ' +
        'content_test_seo, content_test_comment, content_test_landing, ' +
        'content_test_page, content_entry_revisions, ' +
        'media_asset, media_folder, outbox_events, ' +
        // Segments' two. The catalogue is cached in memory and only
        // reloaded by writes through its own service, so a suite that
        // truncates these must also call `reloadSegmentCatalogue` —
        // see `support/segments.ts`.
        'segments, entry_access, ' +
        // Protection's three. None has a foreign key into another plugin's
        // schema, so nothing else's truncate reaches them — and left out, a
        // rule written by one suite would still be in force for the next.
        'protection_rules, review_requests, review_approvals ' +
        'RESTART IDENTITY CASCADE',
    // After the TRUNCATE: `users` is gone, so nothing references these any
    // more. `role_permissions` is ON DELETE CASCADE.
    'DELETE FROM roles WHERE is_system = false',
    // Webhooks are **deleted, not truncated**, and that is load-bearing.
    //
    // `WebhookFanoutSubscriber` runs inside the outbox drain, so the drain now
    // reads `webhook_endpoints` while holding its lock on `outbox_events`. A
    // TRUNCATE naming both takes ACCESS EXCLUSIVE on each in an order Postgres
    // chooses, so it can hold `webhook_endpoints` while waiting for
    // `outbox_events` — exactly opposite to the drain — and the pair deadlock.
    // (Measured: `deadlock detected` inside `resetDb`, then a cascade of 401s
    // in the tests behind it.) `DELETE` takes ROW EXCLUSIVE, which does not
    // conflict with the drain's ACCESS SHARE, so the two simply queue.
    //
    // `webhook_endpoint_workspaces` and `webhook_deliveries` both cascade from
    // this table, so naming the parent is enough.
    'DELETE FROM webhook_endpoints'
];

/** Postgres `lock_not_available` — a `lock_timeout` expired. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * `deadlock_detected`. The same transient contention as a lock timeout, wearing
 * a different code: the truncate and a concurrent outbox drain take the same
 * tables in different orders, Postgres picks a victim, and the victim is
 * whichever transaction it chose — sometimes this one. It is retriable by
 * definition; the whole point of killing one side is that the other proceeds.
 *
 * Left out of the retry, it presented as a `resetDb` failure attributed to
 * whichever test happened to be next — a different one on every run, which is
 * what made it read as five unrelated flakes rather than one cause.
 */
const DEADLOCK_DETECTED = '40P01';

/** How long one attempt waits for the ACCESS EXCLUSIVE lock. */
const LOCK_TIMEOUT_MS = 4_000;

/**
 * Attempts before giving up. Four bounded waits plus backoff stays inside the
 * 30-second hook budget, which is the point: the harness must reach its own
 * diagnosis before Jest reaches its timeout, or the diagnosis never prints.
 */
const LOCK_ATTEMPTS = 4;

/**
 * Run the reset with a **bounded** wait for its locks, retrying, and naming the
 * blocker if it never gets them.
 *
 * `TRUNCATE` needs `ACCESS EXCLUSIVE` on every table it lists, so it queues
 * behind any open transaction touching one of them — and Postgres defaults
 * `lock_timeout` to `0`, meaning *wait forever*. This suite has a writer that
 * makes that a live hazard rather than a theoretical one: `OutboxDispatcher`
 * runs its subscribers **inside** the transaction that claims their rows
 * (`packages/database/src/lib/outbox/outbox-dispatcher.ts`), so a drain holds a
 * transaction on `outbox_events` for as long as the slowest subscriber takes,
 * and a drain is in flight after almost every content-writing test — on commit,
 * and again on the dispatcher's 5-second poll.
 *
 * Unbounded, that presents as `Exceeded timeout of 30000 ms for a hook` with no
 * error, no query and no cause — and then, because Jest abandons a timed-out
 * hook without cancelling the work behind it, the abandoned seed lands *after*
 * the next test's reset and fails **that** test on a duplicate key. One stall,
 * two failures, neither naming it, and the second pointing at an innocent test.
 *
 * Bounded, the common case is unchanged (a drain finishes in well under a
 * second, and attempt 1 succeeds), a slow drain costs one retry, and a genuine
 * hang fails inside the hook budget with the blocking query attached.
 */
async function truncateWithBoundedLockWait(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            // `SET LOCAL` — scoped to this transaction, so the timeout cannot
            // ride the pooled connection back out and clip an app query.
            await client.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`);
            for (const statement of RESET_SQL) await client.query(statement);
            await client.query('COMMIT');
            return;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            const code = (error as { code?: string }).code;
            const retriable =
                code === LOCK_NOT_AVAILABLE || code === DEADLOCK_DETECTED;
            if (!retriable) throw error;
            if (attempt >= LOCK_ATTEMPTS) {
                throw new Error(
                    `[e2e] resetDb could not lock the tables it truncates after ${LOCK_ATTEMPTS} attempts ` +
                        `of ${LOCK_TIMEOUT_MS} ms (last code: ${code}).\n\n` +
                        'Something is holding a transaction open on one of them. The likeliest\n' +
                        'candidate is an outbox drain: `OutboxDispatcher` runs subscribers inside\n' +
                        'the transaction that claims their rows, so a slow subscriber holds\n' +
                        '`outbox_events` for its whole duration.\n\n' +
                        `Backends in this database:\n${await describeBlockers()}`,
                    { cause: error }
                );
            }
            // Linear, not exponential: the blocker is a bounded batch, not a
            // contended resource that backs off usefully.
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        } finally {
            client.release();
        }
    }
}

/**
 * Every non-idle backend and how long its transaction has been open — the
 * answer to "what was holding it", collected while it is still true rather than
 * guessed at afterwards. Best-effort: a diagnosis that throws would replace the
 * message it exists to improve.
 */
async function describeBlockers(): Promise<string> {
    try {
        const { rows } = await getPool().query<{
            pid: number;
            state: string;
            wait_event_type: string | null;
            xact_age: string | null;
            query: string;
        }>(
            `SELECT pid, state, wait_event_type,
                    to_char(now() - xact_start, 'HH24:MI:SS') AS xact_age,
                    left(query, 200) AS query
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND pid <> pg_backend_pid()
                AND state IS DISTINCT FROM 'idle'
              ORDER BY xact_start NULLS LAST`
        );
        if (rows.length === 0) return '  (none — the blocker had already gone)';
        return rows
            .map(
                (row) =>
                    `  pid ${row.pid} ${row.state}` +
                    `${row.wait_event_type ? ` (waiting: ${row.wait_event_type})` : ''}` +
                    `${row.xact_age ? ` xact open ${row.xact_age}` : ''}\n` +
                    `    ${row.query.replace(/\s+/g, ' ')}`
            )
            .join('\n');
    } catch (error) {
        return `  (could not read pg_stat_activity: ${(error as Error).message})`;
    }
}

/**
 * Empty the media library **without** the app's pool — the one reset a spec can
 * do before `createTestApp` and after `closeTestApp`, because it opens and ends
 * a connection of its own.
 *
 * A deployment runs exactly one storage provider, and `StorageProviderCheck`
 * refuses to boot when the library already holds assets some *other* provider
 * wrote. Across a serial run that check is a cross-file hazard in both
 * directions: a spec booting on the filesystem provider inherits the in-memory
 * rows of the file before it, and leaves filesystem rows for the file after it
 * — which boots on the in-memory provider and dies in `beforeAll`, reported as
 * that innocent file's failure. `resetDb` cannot close either gap: it goes
 * through the app's pool, which does not exist before the boot and is closed
 * after it.
 *
 * So any spec that boots on a non-default provider calls this on **both** ends,
 * leaving the library as it found it.
 */
export async function clearMediaLibraryOutOfBand(): Promise<void> {
    const pool = new Pool({ connectionString: resolveDatabaseUrl() });
    try {
        await pool.query(
            'TRUNCATE TABLE media_asset, media_folder RESTART IDENTITY CASCADE'
        );
    } finally {
        await pool.end();
    }
}

/** A seeded media folder row. */
export interface SeededMediaFolder {
    id: string;
}

/**
 * Insert a `media_folder` row directly. `parentId` defaults to `null` (a
 * top-level folder). Scoped to `workspaceId`.
 */
export async function seedMediaFolder(opts: {
    workspaceId: string;
    name: string;
    parentId?: string | null;
}): Promise<SeededMediaFolder> {
    const [row] = await getDatabase()
        .insert(mediaFolder)
        .values({
            workspaceId: opts.workspaceId,
            name: opts.name,
            parentId: opts.parentId ?? null
        })
        .returning();
    return { id: row.id };
}

/**
 * Insert a `media_asset` row directly (for list/scoping/permission tests where
 * the bytes are never read). Its `storage_key` points at the `memory` provider
 * but no blob is written — use an API upload when the download path is exercised.
 * `folderId` defaults to `null` (the workspace root).
 */
export async function seedMediaAsset(opts: {
    workspaceId: string;
    uploadedBy: string;
    name: string;
    folderId?: string | null;
    kind?: 'image' | 'video' | 'audio' | 'document' | 'archive';
    mimeType?: string;
    size?: number;
    /**
     * Alt text. Distinguishes three states the alt-coverage aggregate has to
     * tell apart: absent (`undefined` → NULL), explicitly blank (`''`, which is
     * the markup for "decorative" and must NOT count as covered), and real
     * text.
     */
    alt?: string | null;
    /** Labels on the asset. The listing's search matches these as well as the name. */
    tags?: string[];
}): Promise<{ id: string }> {
    const [row] = await getDatabase()
        .insert(mediaAsset)
        .values({
            workspaceId: opts.workspaceId,
            folderId: opts.folderId ?? null,
            name: opts.name,
            kind: opts.kind ?? 'document',
            mimeType: opts.mimeType ?? 'application/pdf',
            size: opts.size ?? 1024,
            alt: opts.alt ?? null,
            tags: opts.tags ?? [],
            storageKey: `${opts.workspaceId}/seed/${opts.name}`,
            storageProvider: 'memory',
            uploadedBy: opts.uploadedBy
        })
        .returning();
    return { id: row.id };
}

/**
 * Every `media_asset` row in a workspace, whatever folder holds it.
 *
 * `GET /api/media/assets` cannot answer this. It lists **one** folder, and an
 * omitted `folderId` means the workspace *root* (`ListAssetsController` passes
 * `folderId ?? null`), not "everywhere" — so an asset nested in a surviving
 * subfolder is absent from that response whether or not its row is still there.
 * A cascade assertion is about the whole workspace, so it reads the table.
 */
export async function listMediaAssets(
    workspaceId: string
): Promise<{ id: string; folderId: string | null }[]> {
    return getDatabase()
        .select({ id: mediaAsset.id, folderId: mediaAsset.folderId })
        .from(mediaAsset)
        .where(eq(mediaAsset.workspaceId, workspaceId));
}

/** Count `media_asset` rows in a workspace — asserts upload/delete side effects. */
export async function countMediaAssets(workspaceId: string): Promise<number> {
    const rows = await getDatabase()
        .select({ id: mediaAsset.id })
        .from(mediaAsset)
        .where(eq(mediaAsset.workspaceId, workspaceId));
    return rows.length;
}

/** Count `media_folder` rows in a workspace — the purge's other half. */
export async function countMediaFolders(workspaceId: string): Promise<number> {
    const rows = await getDatabase()
        .select({ id: mediaFolder.id })
        .from(mediaFolder)
        .where(eq(mediaFolder.workspaceId, workspaceId));
    return rows.length;
}

/**
 * Insert an `api_token_workspaces` row directly, minting the owning
 * `api_tokens` row too. The bucket is what scopes a token to a workspace; it
 * carries no FK to `workspaces` (identity must not depend on that package), so
 * it is the row a workspace delete has to purge explicitly.
 */
export async function seedApiTokenWorkspaceGrant(opts: {
    workspaceId: string;
    createdBy: string;
    name?: string;
}): Promise<{ tokenId: string }> {
    const { rows } = await getPool().query<{ id: string }>(
        `insert into api_tokens (name, token_hash, lookup_prefix, scope, created_by)
         values ($1, $2, $3, 'read', $4) returning id`,
        [
            opts.name ?? 'purge-test',
            `hash-${Math.random().toString(36).slice(2)}`,
            Math.random().toString(36).slice(2, 10),
            opts.createdBy
        ]
    );
    const tokenId = rows[0].id;
    await getPool().query(
        `insert into api_token_workspaces (token_id, workspace_id) values ($1, $2)`,
        [tokenId, opts.workspaceId]
    );
    return { tokenId };
}

/** Count a workspace's `api_token_workspaces` bucket rows. */
export async function countApiTokenGrants(
    workspaceId: string
): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
        `select count(*)::text as count from api_token_workspaces where workspace_id = $1`,
        [workspaceId]
    );
    return Number(rows[0].count);
}

/** Whether an `api_tokens` row still exists — a purge must not revoke the token. */
export async function apiTokenExists(tokenId: string): Promise<boolean> {
    const { rows } = await getPool().query(
        `select 1 from api_tokens where id = $1`,
        [tokenId]
    );
    return rows.length > 0;
}

/**
 * Insert rows into the `test_article` collection (publishable + paranoid). Each
 * row needs at least `text` + `select` (the type's required fields); `status`
 * defaults to `draft`. Returns the inserted ids in input order (for wiring up
 * relations); assertions still go through the HTTP API.
 *
 * Entries are workspace-scoped: pass `workspaceId` to stamp the owning
 * workspace's `workspace_id` on every row (the value the `WorkspaceGuard`
 * filters by). A per-row `workspaceId` still takes precedence. Omit it only for
 * the "orphan row is invisible" path — rows with a null `workspace_id` are
 * visible to no request.
 */
export async function seedArticles(
    rows: Record<string, unknown>[],
    workspaceId?: string
): Promise<string[]> {
    if (rows.length === 0) return [];
    // The generated table's column set is dynamic, so the insert values aren't
    // statically typed — the column names match the field names by construction.
    // `workspaceId` (the default) merges first so a per-row override wins.
    // `locale` is NOT NULL (the i18n columns have no default), so default it to
    // the config's default locale (`en`); a per-row value wins.
    // The generated table's columns aren't statically typed (see the `as never`
    // on the values above), so project the returned rows rather than naming the
    // `id` column in `.returning()`.
    const inserted = (await getDatabase()
        .insert(testArticles)
        .values(
            rows.map((row) => ({ workspaceId, locale: 'en', ...row })) as never
        )
        .returning()) as { id: string }[];
    return inserted.map((row) => row.id);
}

/**
 * Insert rows into the `test_author` collection and return the inserted ids in
 * input order, so a caller can wire them into an article's `author` FK (the
 * many-to-one side of the relation).
 */
export async function seedAuthors(
    rows: Record<string, unknown>[],
    workspaceId?: string
): Promise<string[]> {
    if (rows.length === 0) return [];
    // `test_author` is i18n, so `locale` is NOT NULL with no default (see
    // {@link seedArticles}); a per-row value still wins.
    const inserted = (await getDatabase()
        .insert(testAuthors)
        .values(
            rows.map((row) => ({ workspaceId, locale: 'en', ...row })) as never
        )
        .returning()) as { id: string }[];
    return inserted.map((row) => row.id);
}

/**
 * Insert rows into the `test_tag` collection and return the inserted ids in
 * input order — the far side of the `test_article.tags` many-to-many. Unlike
 * {@link seedArticles} / {@link seedAuthors}, `test_tag` is **not** i18n, so it
 * has no `locale` column to default.
 */
export async function seedTags(
    rows: Record<string, unknown>[],
    workspaceId?: string
): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = (await getDatabase()
        .insert(testTags)
        .values(rows.map((row) => ({ workspaceId, ...row })) as never)
        .returning()) as { id: string }[];
    return inserted.map((row) => row.id);
}

/**
 * Insert rows into the `test_page` collection (the self-referential tree) and
 * return the inserted ids in input order. Rows are inserted **one at a time**,
 * in order, so a later row can name an earlier one as its `parent` — a batch
 * insert couldn't reference an id it hasn't returned yet. Not i18n, not
 * publishable, so `title` is the only required value.
 */
export async function seedPages(
    rows: Record<string, unknown>[],
    workspaceId?: string
): Promise<string[]> {
    const ids: string[] = [];
    for (const row of rows) {
        const [inserted] = (await getDatabase()
            .insert(testPages)
            .values({ workspaceId, ...row } as never)
            .returning()) as { id: string }[];
        ids.push(inserted.id);
    }
    return ids;
}

/** The envelope columns of one `test_article` row — the write assertions' oracle. */
export interface ArticleEnvelope {
    id: string;
    status: string;
    deletedAt: Date | null;
    workspaceId: string | null;
}

/**
 * Read the envelope of `test_article` rows straight from the table.
 *
 * The point is asserting what a request did **not** do: a bulk action given an
 * id from another workspace must leave that row exactly as it was, and the
 * response body alone cannot show it. Raw parameterized SQL, like
 * {@link softDeleteAuthors} — the generated table's columns aren't statically
 * typed.
 */
export async function getArticleRows(
    ids: string[]
): Promise<ArticleEnvelope[]> {
    if (ids.length === 0) return [];
    const { rows } = await getPool().query(
        'SELECT id, status, deleted_at, workspace_id FROM content_test_article WHERE id = ANY($1::uuid[])',
        [ids]
    );
    return (
        rows as {
            id: string;
            status: string;
            deleted_at: Date | null;
            workspace_id: string | null;
        }[]
    ).map((row) => ({
        id: row.id,
        status: row.status,
        deletedAt: row.deleted_at,
        workspaceId: row.workspace_id
    }));
}

/**
 * Soft-delete `test_author` rows (stamp `deleted_at`), so a spec can assert a
 * relation filter no longer traverses them — the workspace + soft-delete
 * `scope` the engine ANDs inside a relation's EXISTS subquery. Writes the
 * tombstone directly rather than through the API, mirroring the other seeders.
 */
export async function softDeleteAuthors(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    // Raw parameterized UPDATE (like {@link resetDb}) — the generated table's
    // columns aren't statically typed, so `getPool` is cleaner than reaching
    // for an untyped `.id` column off the Drizzle table.
    await getPool().query(
        'UPDATE content_test_author SET deleted_at = now() WHERE id = ANY($1::uuid[])',
        [ids]
    );
}

/**
 * Link an article to tags in the generated join table, ordered by array index
 * (`position`) — the same ordering the relation read pages by. Writes the join
 * rows directly rather than going through the API, so a spec can stand up a
 * relation with many links cheaply.
 */
export async function seedArticleTags(
    articleId: string,
    tagIds: string[]
): Promise<void> {
    if (tagIds.length === 0) return;
    await getDatabase()
        .insert(testArticleTags)
        .values(
            tagIds.map((tagId, index) => ({
                sourceId: articleId,
                targetId: tagId,
                position: index
            })) as never
        );
}

/**
 * Insert rows into the `test_landing` page (non-publishable: no `status`
 * column). Pass `workspaceId` to stamp the owning workspace on every row (a
 * per-row `workspaceId` still wins); see {@link seedArticles}.
 */
export async function seedLanding(
    rows: Record<string, unknown>[],
    workspaceId?: string
): Promise<void> {
    if (rows.length === 0) return;
    // `locale` is NOT NULL (see {@link seedArticles}); default it to `en`.
    await getDatabase()
        .insert(testLandingPage)
        .values(
            rows.map((row) => ({ workspaceId, locale: 'en', ...row })) as never
        );
}
