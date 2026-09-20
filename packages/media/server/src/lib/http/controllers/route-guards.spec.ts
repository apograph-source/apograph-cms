import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod, type Type } from '@nestjs/common';
import {
    OriginGuard,
    PERMISSIONS,
    PERMISSIONS_KEY,
    PermissionsGuard
} from '@orthacms/identity-server';
import {
    ApiTokenGuard,
    ApiTokenWorkspaceGuard
} from '@orthacms/content-server';
import { WorkspaceGuard } from '@orthacms/workspaces-server';
import { MediaModule } from '../../media.module';
import type { StorageProvider } from '@orthacms/media-domain';

/** Nest's own metadata keys — string literals in `@nestjs/common/constants`. */
const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/** The four keys this plugin is allowed to gate on. */
const MEDIA_PERMISSIONS: string[] = [
    PERMISSIONS.MEDIA_READ,
    PERMISSIONS.MEDIA_CREATE,
    PERMISSIONS.MEDIA_UPDATE,
    PERMISSIONS.MEDIA_DELETE
];

/** A provider stub: `forRoot` only binds it, and nothing here resolves DI. */
const PROVIDER = { id: 'route-guards-stub' } as unknown as StorageProvider;

/** The controllers `MediaModule.forRoot()` actually mounts. */
const CONTROLLERS = (MediaModule.forRoot({
    provider: PROVIDER,
    maxUploadBytes: 1
}).controllers ?? []) as Type[];

/** One mounted HTTP route, with everything gating it. */
interface Route {
    /** `PATCH /media/assets/:id` — the key everything is indexed by. */
    key: string;
    /** The declaring controller's class name, for readable failures. */
    controller: string;
    /** Class- and handler-level guards, merged. */
    guards: unknown[];
    /** The permission keys the route requires, class- and handler-level. */
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
                permissions: merged(
                    PERMISSIONS_KEY,
                    controller,
                    handler
                ) as string[]
            };
        });
}

const ROUTES = CONTROLLERS.flatMap(routesOf);

/** `[key, route]` pairs, so a failure names the route. */
const ROUTE_CASES = ROUTES.map((route) => [route.key, route] as const);

/**
 * The token half. These two are reached with a bearer token rather than a
 * cookie, so they are authorized by identity's `ApiTokenGuard` and scoped by
 * `ApiTokenWorkspaceGuard`; a CSRF guard on them would be meaningless (there is
 * no ambient credential for a browser to replay) and a `WorkspaceGuard` would
 * be wrong (there is no session user to be a member).
 */
const TOKEN_ROUTES = ['POST /v1/media/assets', 'GET /v1/media/assets/:id/raw'];

/**
 * The one session route without `WorkspaceGuard`, and the reason it is exempt:
 * it takes the workspace from the asset's own row rather than from a header, so
 * there is nothing for the guard to authorize. It asks the same membership
 * probe itself and answers 404 — see `download-asset.controller.ts`.
 */
const HEADER_FREE_ROUTE = 'GET /media/assets/:id/raw';

const isTokenRoute = (route: Route) => TOKEN_ROUTES.includes(route.key);
const isSessionRoute = (route: Route) => !isTokenRoute(route);

/** Whether a route changes state — the set `OriginGuard` exists for. */
const isStateChanging = (route: Route) => !route.key.startsWith('GET ');

/**
 * The media plugin's authorization posture, asserted over **every** route the
 * module mounts rather than one route at a time.
 *
 * This is the shape of claim an HTTP suite cannot make. `media-route-access`
 * proves that each of today's routes refuses the wrong caller; it cannot prove
 * that the *next* route to land will. Each guard is one decorator on one class,
 * and a sixteenth controller that forgets `WorkspaceGuard` works perfectly — it
 * just takes its workspace from an unvalidated header, for everyone, in every
 * tenant. Iterating the module's own `controllers` array is what makes a new
 * route inherit these assertions instead of needing somebody to remember.
 *
 * Modelled on `workspaces/server`'s `route-guards.spec.ts`, which does the same
 * for the tenancy routes.
 */
describe('MediaModule route guards', () => {
    it('mounts routes at all — the loops below are only as good as their input', () => {
        expect(CONTROLLERS.length).toBeGreaterThan(0);
        expect(ROUTES.length).toBeGreaterThanOrEqual(CONTROLLERS.length);
    });

    it('mounts exactly the routes this file reasons about', () => {
        // Named explicitly as well as generated, so a new route cannot join the
        // plugin without somebody deciding, here, which of the rules below it
        // is subject to.
        expect(ROUTES.map((route) => route.key).sort()).toEqual([
            'DELETE /media/assets',
            'DELETE /media/folders/:id',
            'GET /insights/media/alt',
            'GET /insights/media/storage',
            'GET /insights/media/uploads',
            'GET /media/assets',
            'GET /media/assets/:id/raw',
            'GET /media/folders',
            'GET /v1/media/assets/:id/raw',
            'PATCH /media/assets/:id',
            'PATCH /media/folders/:id',
            'POST /media/assets',
            'POST /media/assets/:id/duplicate',
            'POST /media/folders',
            'POST /v1/media/assets'
        ]);
    });

    describe('permissions — every route is gated, on a media key [media:I-15]', () => {
        it.each(ROUTE_CASES)(
            '%s requires exactly one PERMISSIONS.MEDIA_* key',
            (_key, subject) => {
                // Both halves matter. "At least one" would pass for a route
                // that also demanded something unrelated; "a media key" is what
                // stops `content:read` being written here, which would gate the
                // library on whether the caller may read entries.
                expect(subject.permissions).toHaveLength(1);
                expect(MEDIA_PERMISSIONS).toContain(subject.permissions[0]);
            }
        );

        it.each(ROUTE_CASES.filter(([, route]) => isSessionRoute(route)))(
            '%s binds PermissionsGuard',
            (_key, subject) => {
                // A `@RequirePermissions` with no guard to read it is metadata
                // nobody enforces — the failure mode that looks most like
                // working code.
                expect(subject.guards).toContain(PermissionsGuard);
            }
        );

        it.each(ROUTE_CASES.filter(([, route]) => isTokenRoute(route)))(
            '%s binds ApiTokenGuard, which reads the same metadata',
            (_key, subject) => {
                expect(subject.guards).toContain(ApiTokenGuard);
                expect(subject.guards).toContain(ApiTokenWorkspaceGuard);
            }
        );

        it('writes those keys as constants, never as string literals', () => {
            // The clause the metadata above cannot see: `'media:create'` typed
            // by hand is indistinguishable from `PERMISSIONS.MEDIA_CREATE` once
            // it is a string. A typo in a literal fails **closed** and looks
            // like a bug; the wrong key spelled correctly fails **open** and
            // looks like nothing.
            const files = readdirSync(__dirname).filter(
                (name) =>
                    name.endsWith('.controller.ts') &&
                    !name.endsWith('.spec.ts')
            );
            expect(files.length).toBe(CONTROLLERS.length);

            // Code lines only: every one of these controllers names its
            // permission in prose ("`media:create` gates it"), and counting
            // documentation as a literal would make this permanently red.
            const literals = files.filter((name) =>
                readFileSync(join(__dirname, name), 'utf8')
                    .split('\n')
                    .filter((line) => {
                        const trimmed = line.trimStart();
                        return (
                            !trimmed.startsWith('*') &&
                            !trimmed.startsWith('//') &&
                            !trimmed.startsWith('/*')
                        );
                    })
                    .some((line) =>
                        /['"`]media:(read|create|update|delete)['"`]/.test(line)
                    )
            );
            expect(literals).toEqual([]);
        });
    });

    describe('CSRF — state-changing session routes carry OriginGuard [media:I-15]', () => {
        it.each(ROUTE_CASES.filter(([, route]) => isSessionRoute(route)))(
            '%s carries OriginGuard iff it changes state',
            (_key, subject) => {
                // Both directions on purpose. A missing guard lets any page the
                // editor is visiting spend their cookie; a guard on a read
                // would break every cross-origin GET for no gain, which is a
                // different bug and just as invisible in a green suite.
                expect(subject.guards.includes(OriginGuard)).toBe(
                    isStateChanging(subject)
                );
            }
        );

        it.each(ROUTE_CASES.filter(([, route]) => isTokenRoute(route)))(
            '%s carries none — a bearer token is not replayable by a page',
            (_key, subject) => {
                expect(subject.guards).not.toContain(OriginGuard);
            }
        );
    });

    describe('tenancy — every session route but one carries WorkspaceGuard [media:I-16]', () => {
        it.each(ROUTE_CASES.filter(([, route]) => isSessionRoute(route)))(
            '%s carries WorkspaceGuard unless it derives its scope from the row',
            (_key, subject) => {
                expect(subject.guards.includes(WorkspaceGuard)).toBe(
                    subject.key !== HEADER_FREE_ROUTE
                );
            }
        );

        it('has exactly one such exception', () => {
            // The list is asserted, not just the predicate: a second route
            // dropping the guard would otherwise only have to be added to
            // `HEADER_FREE_ROUTE` to go green.
            expect(
                ROUTES.filter(
                    (route) =>
                        isSessionRoute(route) &&
                        !route.guards.includes(WorkspaceGuard)
                ).map((route) => route.key)
            ).toEqual([HEADER_FREE_ROUTE]);
        });

        it.each(ROUTE_CASES.filter(([, route]) => isTokenRoute(route)))(
            '%s is scoped by the token bucket instead',
            (_key, subject) => {
                // Not an exemption: there is no session user to be a member of
                // anything, so the equivalent boundary is the token's own
                // workspace list.
                expect(subject.guards).not.toContain(WorkspaceGuard);
                expect(subject.guards).toContain(ApiTokenWorkspaceGuard);
            }
        );
    });
});
