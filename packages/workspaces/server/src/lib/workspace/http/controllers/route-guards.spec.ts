import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import {
    PERMISSIONS,
    PERMISSIONS_KEY,
    PermissionsGuard,
    RequireAnyPermission
} from '@orthacms/identity-server';
import { WorkspacesModule } from '../../../workspaces.module';
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';

/** Nest's own metadata keys — string literals in `@nestjs/common/constants`. */
const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/**
 * The key `@RequireAnyPermission()` writes. Taken from the decorator factory
 * itself (`SetMetadata` hangs the key off it as `KEY`) because identity's
 * `ANY_PERMISSION_KEY` constant — unlike `PERMISSIONS_KEY` — is not on its
 * public barrel, and a copied string literal is exactly the drift this file
 * exists to catch.
 */
const ANY_PERMISSION_KEY = (
    RequireAnyPermission() as unknown as { KEY: string }
).KEY;

/** Every permission key the shared catalogue defines. */
const KNOWN_PERMISSIONS: string[] = Object.values(PERMISSIONS);

/** The controllers `WorkspacesModule.forRoot()` actually mounts. */
const CONTROLLERS = (WorkspacesModule.forRoot().controllers ?? []) as Type[];

/** One mounted HTTP route, with everything gating it. */
interface Route {
    /** `GET /workspaces/:id/entry-count` — the key everything is indexed by. */
    key: string;
    /** The declaring controller's class name, for readable failures. */
    controller: string;
    /** Class- and handler-level guards, merged. */
    guards: unknown[];
    /** All-of and any-of permission keys, merged. */
    permissions: string[];
}

/** Class-level metadata plus the handler's own, merged into one list. */
function merged(key: string, controller: Type, handler: object): unknown[] {
    return [
        ...((Reflect.getMetadata(key, controller) as unknown[]) ?? []),
        ...((Reflect.getMetadata(key, handler) as unknown[]) ?? [])
    ];
}

/** Joins a controller prefix and a route path into one leading-slash path. */
function joinPath(...segments: string[]): string {
    const parts = segments
        .flatMap((segment) => segment.split('/'))
        .filter((part) => part.length > 0);
    return `/${parts.join('/')}`;
}

/** Every route a controller declares. */
function routesOf(controller: Type): Route[] {
    const prefix = (Reflect.getMetadata(PATH_METADATA, controller) ??
        '') as string;
    return Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => (controller.prototype as Record<string, object>)[name])
        .filter(
            (handler) =>
                Reflect.getMetadata(METHOD_METADATA, handler) !== undefined
        )
        .map((handler) => {
            const method = Reflect.getMetadata(
                METHOD_METADATA,
                handler
            ) as RequestMethod;
            const path = (Reflect.getMetadata(PATH_METADATA, handler) ??
                '') as string;
            return {
                key: `${RequestMethod[method]} ${joinPath(prefix, path)}`,
                controller: controller.name,
                guards: merged(GUARDS_METADATA, controller, handler),
                permissions: [
                    ...(merged(
                        PERMISSIONS_KEY,
                        controller,
                        handler
                    ) as string[]),
                    ...(merged(
                        ANY_PERMISSION_KEY,
                        controller,
                        handler
                    ) as string[])
                ]
            };
        });
}

const ROUTES = CONTROLLERS.flatMap(routesOf);

/** `[key, route]` pairs, so a failure names the route. */
const ROUTE_CASES = ROUTES.map((route) => [route.key, route] as const);

/** Whether a route names its workspace in the path rather than the header. */
function isWorkspaceScoped(route: Route): boolean {
    return /:(id|workspaceId)(\/|$)/.test(route.key);
}

/** The one route with this key; fails loudly rather than returning undefined. */
function route(key: string): Route {
    const found = ROUTES.filter((candidate) => candidate.key === key);
    expect(found.map((candidate) => candidate.key)).toEqual([key]);
    return found[0];
}

/**
 * The workspaces plugin's authorization posture, asserted over **every** route
 * the module mounts rather than one at a time.
 *
 * This is the shape of claim behavioural e2e cannot express. A test can prove
 * that `DELETE /workspaces/:id` refuses a non-member; it cannot prove that the
 * *next* `/workspaces/:id/…` route to land will. Each guard here is one
 * decorator on one class, and a fourteenth controller that forgets it works
 * perfectly — it just works for everyone, in every tenant. Iterating the
 * module's own `controllers` array is what makes a new route inherit these
 * assertions instead of needing someone to remember to add them.
 */
describe('WorkspacesModule route guards', () => {
    it('mounts routes at all — the loops below are only as good as their input', () => {
        expect(CONTROLLERS.length).toBeGreaterThan(0);
        expect(ROUTES.length).toBeGreaterThanOrEqual(CONTROLLERS.length);
    });

    describe('membership — where a caller may act', () => {
        it.each(ROUTE_CASES)(
            // covers: workspaces:I-05
            '%s carries WorkspaceMemberGuard iff it names a workspace in the path',
            (_key, subject) => {
                // Both directions on purpose. A missing guard is a tenancy
                // hole; a guard on a route with no `:id` would 400 every
                // request against it, which is a different bug entirely.
                expect(subject.guards.includes(WorkspaceMemberGuard)).toBe(
                    isWorkspaceScoped(subject)
                );
            }
        );

        it('guards the two read-only preview counters too [workspaces:I-05]', () => {
            // The easiest omission to rationalise: they only return a number,
            // so why guard a read? Because the number is "how much content
            // does workspace X hold" — an answer no non-member is entitled to,
            // and one that confirms the id exists.
            for (const key of [
                'GET /workspaces/:id/entry-count',
                'GET /workspaces/:id/content/:slug/entry-count'
            ]) {
                expect(route(key).guards).toContain(WorkspaceMemberGuard);
            }
        });

        it('guards every route the module scopes by path', () => {
            // Named explicitly as well as generated above, so deleting the
            // `:id` from a path can't quietly shrink the covered set.
            expect(
                ROUTES.filter(isWorkspaceScoped)
                    .map((scoped) => scoped.key)
                    .sort()
            ).toEqual([
                'DELETE /workspaces/:id',
                'DELETE /workspaces/:id/content/:slug',
                'DELETE /workspaces/:id/members/:userId',
                'GET /workspaces/:id/content/:slug/entry-count',
                'GET /workspaces/:id/entry-count',
                'PATCH /workspaces/:id',
                'POST /workspaces/:id/archive',
                'POST /workspaces/:id/content',
                'POST /workspaces/:id/members',
                'POST /workspaces/:id/unarchive'
            ]);
        });
    });

    describe('permissions — what a caller may do', () => {
        it.each(ROUTE_CASES)('%s binds PermissionsGuard', (_key, subject) => {
            expect(subject.guards).toContain(PermissionsGuard);
        });

        it.each(ROUTE_CASES)(
            '%s requires a permission from the shared catalogue',
            (_key, subject) => {
                // Inline permission strings are the failure this catches: a
                // typo'd `'workspaces:updat'` is a permission nobody holds, so
                // it fails closed and looks like a bug — while
                // `'workspaces:read'` written where `workspaces:update` was
                // meant fails **open** and looks like nothing.
                expect(subject.permissions.length).toBeGreaterThan(0);
                for (const permission of subject.permissions) {
                    expect(KNOWN_PERMISSIONS).toContain(permission);
                }
            }
        );

        it('gates the slug-availability probe on workspaces:create [workspaces:I-29]', () => {
            // Authentication alone was not enough: the probe answers "does
            // this slug exist" for any caller, which turns any signed-in
            // account into a directory of the tenancy, one guess at a time.
            // The answer is only good for one thing, so it is gated on being
            // able to do that thing.
            expect(route('GET /workspaces/slug-available').permissions).toEqual(
                [PERMISSIONS.WORKSPACES_CREATE]
            );
        });
    });

    describe('preview counters are gated as the action they precede', () => {
        // Asserted as a *pairing*, not as two literals. What matters is not
        // that the count needs `workspaces:delete` today — it is that whoever
        // may see the pre-check is exactly whoever may act on it. Re-gate the
        // delete and this fails until the counter follows, which is the point:
        // a counter left on a weaker permission becomes a way to measure a
        // workspace you could never delete.
        it.each([
            [
                'workspace delete',
                'GET /workspaces/:id/entry-count',
                'DELETE /workspaces/:id'
            ],
            [
                'content revoke',
                'GET /workspaces/:id/content/:slug/entry-count',
                'DELETE /workspaces/:id/content/:slug'
            ]
        ])(
            // covers: workspaces:I-30
            "the %s counter matches its action's permission",
            (_label, counter, action) => {
                expect(route(counter).permissions).toEqual(
                    route(action).permissions
                );
                expect(route(counter).permissions.length).toBe(1);
            }
        );
    });
});
