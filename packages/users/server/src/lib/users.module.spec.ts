import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import {
    PERMISSIONS,
    PERMISSIONS_KEY,
    OriginGuard,
    PermissionsGuard,
    Public
} from '@orthacms/identity-server';
import { UsersModule } from './users.module';

/** Nest's own metadata keys — string literals in `@nestjs/common/constants`. */
const GUARDS_METADATA = '__guards__';
const METHOD_METADATA = 'method';

/**
 * The key `@Public()` writes, taken from the decorator factory itself
 * (`SetMetadata` hangs the key off it as `KEY`) rather than from identity's
 * unexported constant — so this stays correct if the string ever changes.
 */
const IS_PUBLIC_KEY = (Public() as unknown as { KEY: string }).KEY;

/** Every permission key the shared catalogue defines. */
const KNOWN_PERMISSIONS: string[] = Object.values(PERMISSIONS);

/** The controllers the plugin actually mounts. */
const CONTROLLERS = (UsersModule.forRoot().controllers ?? []) as Type[];

/** `[name, class]` pairs, so a failure names the controller. */
const CASES = CONTROLLERS.map(
    (controller) => [controller.name, controller] as const
);

/** The route handlers declared on a controller. */
function handlersOf(controller: Type): { name: string; fn: object }[] {
    return Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => ({
            name,
            fn: (controller.prototype as Record<string, object>)[name]
        }))
        .filter(
            (handler) =>
                Reflect.getMetadata(METHOD_METADATA, handler.fn) !== undefined
        );
}

/**
 * The users plugin's authorization posture, asserted over **every** controller
 * the module mounts rather than one at a time.
 *
 * This is the shape of claim that regresses silently. Each guard here is one
 * decorator on one class, and a ninth controller that forgets it still works
 * perfectly — it just works for everyone. Iterating the module's own
 * `controllers` array is what makes the new one inherit the assertions instead
 * of needing someone to remember to add them.
 */
describe('UsersModule authorization posture', () => {
    it('mounts controllers at all — the loop below is only as good as its input', () => {
        expect(CONTROLLERS.length).toBeGreaterThan(0);
    });

    // covers: users:I-12
    it.each(CASES)('%s binds PermissionsGuard', (_name, controller) => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
        expect(guards).toContain(PermissionsGuard);
    });

    it.each(CASES)(
        // covers: users:I-12
        '%s requires a permission from the shared catalogue',
        (_name, controller) => {
            const required: unknown[] =
                Reflect.getMetadata(PERMISSIONS_KEY, controller) ?? [];

            // Inline permission strings are the failure this catches: a typo'd
            // `'users:updat'` is a permission nobody holds, which fails closed
            // and looks like a bug — while `'users:read'` written where
            // `users:update` was meant fails **open** and looks like nothing.
            expect(required.length).toBeGreaterThan(0);
            for (const permission of required) {
                expect(KNOWN_PERMISSIONS).toContain(permission);
            }
        }
    );

    it.each(CASES)(
        // covers: users:I-12
        '%s binds OriginGuard when it has a state-changing handler',
        (_name, controller) => {
            const methods = handlersOf(controller).map((handler) =>
                Reflect.getMetadata(METHOD_METADATA, handler.fn)
            );
            const mutates = methods.some(
                (method) => method !== RequestMethod.GET
            );
            const guards =
                Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];

            // CSRF: the session cookie is `SameSite=Lax`, which makes a missing
            // OriginGuard latent rather than exploitable — until a deployment
            // needs `SameSite=None` for a cross-origin admin.
            expect(guards.includes(OriginGuard)).toBe(mutates);
        }
    );

    // covers: users:I-12
    it.each(CASES)('%s exposes no public route', (_name, controller) => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller)).toBeUndefined();
        for (const handler of handlersOf(controller)) {
            expect(
                Reflect.getMetadata(IS_PUBLIC_KEY, handler.fn)
            ).toBeUndefined();
        }
    });

    it.each(CASES)('%s declares at least one route', (_name, controller) => {
        // Guards are bound at the class, so a controller with no handler would
        // pass every assertion above while proving nothing.
        expect(handlersOf(controller).length).toBeGreaterThan(0);
    });
});

describe('UsersModule.forRoot', () => {
    it('exports nothing and is not global — every provider stays private [users:I-18]', () => {
        const module = UsersModule.forRoot();

        expect(module.exports).toBeUndefined();
        expect(module.global).toBeFalsy();
        expect(module.module).toBe(UsersModule);
    });
});
