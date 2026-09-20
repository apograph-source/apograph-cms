import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import { PrincipalMiddleware } from './principal.middleware';
import { PrincipalStore } from '../application/principal.store';

const RESPONSE = {} as Response;

/** A request the guards have (or have not yet) resolved a user onto. */
function requestFor(user?: { id: string }): AuthenticatedRequest {
    return { user } as unknown as AuthenticatedRequest;
}

describe('PrincipalMiddleware', () => {
    /**
     * The asymmetry with `ReaderMiddleware`, and the reason it is worth an
     * assertion of its own: the reader half is *allowed* to skip its work when
     * no segment exists, and this half is not. Everything downstream that asks
     * "may this caller change who reads the entry" reads the answer out of this
     * store, and an absent principal is a refusal — so a request that slipped
     * past this middleware is not an open door, it is a save that 403s for no
     * reason anyone can see.
     */
    it('runs every request inside the principal scope [segments:I-40]', () => {
        const store = new PrincipalStore();
        const middleware = new PrincipalMiddleware(store);
        const request = requestFor({ id: 'u1' });

        let inScope: unknown;
        const next = jest.fn(() => {
            inScope = store.current();
        }) as unknown as NextFunction;

        middleware.use(request, RESPONSE, next);

        expect(next).toHaveBeenCalledTimes(1);
        // In scope *during* `next`, not merely called beside it: the store is
        // an `AsyncLocalStorage`, so a `next()` outside the `run` leaves every
        // downstream reader with `undefined`.
        expect(inScope).toEqual({ id: 'u1' });
        // And the scope closes with the request rather than leaking into the
        // next one on the same tick.
        expect(store.current()).toBeUndefined();
    });

    it('continues a request no guard has authenticated [segments:I-40]', () => {
        // The condition under which a short-circuit would be tempting — there
        // is no user to store — is exactly the one where stopping would break
        // every unauthenticated route in the installation.
        const store = new PrincipalStore();
        const middleware = new PrincipalMiddleware(store);

        let called = false;
        const next = jest.fn(() => {
            called = true;
            expect(store.current()).toBeUndefined();
        }) as unknown as NextFunction;

        middleware.use(requestFor(), RESPONSE, next);

        expect(called).toBe(true);
        expect(next).toHaveBeenCalledTimes(1);
    });

    /**
     * The store holds the **request**, not the user, because this middleware
     * runs before the guards that resolve one. A reader that snapshotted
     * `request.user` at `run` time would answer `undefined` for the whole
     * request and refuse every access write on it.
     */
    it('reads the user the guards attach after it ran', () => {
        const store = new PrincipalStore();
        const middleware = new PrincipalMiddleware(store);
        const request = requestFor();

        let resolved: unknown;
        const next = jest.fn(() => {
            // What a guard does, on the same object, after this middleware.
            (request as { user?: { id: string } }).user = { id: 'u2' };
            resolved = store.current();
        }) as unknown as NextFunction;

        middleware.use(request, RESPONSE, next);

        expect(resolved).toEqual({ id: 'u2' });
    });
});
