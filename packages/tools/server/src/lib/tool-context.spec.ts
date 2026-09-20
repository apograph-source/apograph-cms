import { PERMISSIONS, PERMISSION_KEYS } from '@orthacms/identity-server';
import type { PermissionKey } from '@orthacms/identity-server';
import { createToolContext } from './tool-context';
import type { ToolActor } from './tool';

/**
 * `createToolContext` is four lines long, and the invariant it carries is about
 * the four lines it does **not** contain.
 *
 * `can()` answers from `actor.grantedPermissions` and from nothing else — no
 * role lookup, no implication table, no "an administrator holds everything"
 * shortcut. Rights are resolved once, at the edge, by whoever authenticated the
 * caller: the MCP endpoint turns a bearer token's scope into a set via
 * `scopePermissions`, the copilot turns a signed-in user's roles into one via
 * identity's RBAC service, and both hand the finished set over. A second
 * derivation here would be a second authorization model — the exact thing this
 * package was extracted to prevent — and it would be invisible to the registry
 * tests, which build their contexts from sets they already control.
 */

/** An actor holding exactly the named permissions. */
function actor(
    permissions: readonly string[],
    overrides: Partial<ToolActor> = {}
): ToolActor {
    return {
        kind: 'token',
        id: 'token-1',
        displayName: 'test token',
        grantedPermissions: new Set(permissions),
        userId: null,
        ...overrides
    };
}

describe('createToolContext', () => {
    it('carries the actor and workspace through untouched', () => {
        const handed = actor([PERMISSIONS.CONTENT_READ]);
        const ctx = createToolContext(handed, 'workspace-1');

        expect(ctx.actor).toBe(handed);
        expect(ctx.workspaceId).toBe('workspace-1');
    });

    describe('can() answers from the handed-over set and nothing else', () => {
        it('says yes to exactly what was granted, across the whole dictionary [tools:I-04]', () => {
            // Asserted over `PERMISSION_KEYS` rather than a couple of samples
            // on purpose: the failure mode worth catching is a `can()` that
            // *widens*, and a widening is only visible against every key it
            // could have invented. An implementation that resolved the actor's
            // role, expanded a wildcard, or defaulted an unknown key to `true`
            // fails on one of the other ~40 keys here.
            const granted = [PERMISSIONS.CONTENT_READ, PERMISSIONS.MEDIA_READ];
            const ctx = createToolContext(actor(granted), 'workspace-1');

            expect(PERMISSION_KEYS.length).toBeGreaterThan(10);

            const answeredYes = PERMISSION_KEYS.filter((key) => ctx.can(key));
            expect([...answeredYes].sort()).toEqual([...granted].sort());
        });

        it('derives nothing from a neighbouring permission [tools:I-04]', () => {
            // The tempting implication — "you may delete, so surely you may
            // read" — is the shape a re-derivation would most plausibly take,
            // and it is wrong here: `can()` is exact-match set membership, so a
            // token whose scope minted only `content:delete` cannot read.
            const ctx = createToolContext(
                actor([PERMISSIONS.CONTENT_DELETE]),
                'workspace-1'
            );

            expect(ctx.can(PERMISSIONS.CONTENT_DELETE)).toBe(true);
            expect(ctx.can(PERMISSIONS.CONTENT_READ)).toBe(false);
            expect(ctx.can(PERMISSIONS.CONTENT_UPDATE)).toBe(false);
        });

        it('reads nothing from who the actor is [tools:I-04]', () => {
            // Same set, opposite identities: a bearer token attributed to
            // nobody, and a signed-in user with an id a role lookup could be
            // performed against. The two contexts must answer identically for
            // every key — `userId` is attribution, never authorization
            // (I-05), and `kind` decides no rights either.
            const permissions = [PERMISSIONS.CONTENT_READ];
            const token = createToolContext(
                actor(permissions, { kind: 'token', userId: 'user-9' }),
                'workspace-1'
            );
            const user = createToolContext(
                actor(permissions, {
                    kind: 'user',
                    id: 'user-9',
                    userId: 'user-9'
                }),
                'workspace-1'
            );

            const answers = (ctx: { can(key: PermissionKey): boolean }) =>
                PERMISSION_KEYS.map((key) => `${key}=${ctx.can(key)}`);

            expect(answers(user)).toEqual(answers(token));
            expect(answers(token)).toContain(
                `${PERMISSIONS.CONTENT_READ}=true`
            );
        });

        it('grants nothing at all to an actor handed an empty set [tools:I-04]', () => {
            // The floor. Whoever authenticated the caller may legitimately
            // resolve *no* permissions — a token whose scope was revoked, a
            // user with no role in this workspace — and the context must not
            // improvise a baseline for them.
            const ctx = createToolContext(actor([]), 'workspace-1');

            expect(PERMISSION_KEYS.filter((key) => ctx.can(key))).toEqual([]);
        });
    });
});
