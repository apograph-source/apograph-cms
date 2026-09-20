import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { SegmentResolver } from '@orthacms/segments-domain';
import { ReaderMiddleware } from './reader.middleware';
import { ReaderStore } from '../application/reader.store';
import { SegmentCatalogService } from '../application/segment-catalog.service';
import type { SegmentsPluginConfig } from '../types/segments-config';

/**
 * A catalogue that reports itself configured and resolves the tags it is given
 * to one segment each. Only the two methods the middleware reaches.
 */
function catalogue(configured = true): SegmentCatalogService {
    return {
        configured,
        resolveTags: (tags: readonly string[]) =>
            new Set(tags.map((tag) => `segment-for-${tag}`))
    } as unknown as SegmentCatalogService;
}

/** A resolver that answers with `tags`, or fails the way `behaviour` says. */
function resolverOf(
    behaviour: { tags: string[] } | { throws: unknown } | { rejects: unknown }
): SegmentResolver<unknown> {
    return {
        resolve: async () => {
            if ('throws' in behaviour) throw behaviour.throws;
            if ('rejects' in behaviour)
                return Promise.reject(behaviour.rejects);
            return behaviour.tags;
        }
    } as SegmentResolver<unknown>;
}

/** The plugin config a host writes — one optional line. */
function config(resolver?: SegmentResolver<unknown>): SegmentsPluginConfig {
    return { resolver };
}

const REQUEST = {} as Request;
const RESPONSE = {} as Response;

describe('ReaderMiddleware', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
            /* keep the failure out of the test output */
        });
    });

    afterEach(() => {
        warn.mockRestore();
    });

    /**
     * The claim the whole entitlement source rests on: an outage of the system
     * that says who a reader is degrades the site to its public content rather
     * than taking it off the air. Nothing else in the plugin catches for it —
     * a throw here would leave Nest's exception filter answering 500 to a reader
     * who was entitled to nothing more than the unrestricted entries anyway.
     */
    it('serves an anonymous reader when the resolver throws [segments:I-35]', async () => {
        const store = new ReaderStore();
        const middleware = new ReaderMiddleware(
            config(resolverOf({ throws: new Error('entitlement API down') })),
            catalogue(),
            store
        );

        let seen: { tags: readonly string[]; ids: number } | undefined;
        const next = jest.fn(() => {
            const reader = store.current();
            seen = { tags: reader.tags, ids: reader.segmentIds.size };
        }) as unknown as NextFunction;

        await middleware.use(REQUEST, RESPONSE, next);

        // The request continued, and continued as nobody: no tags, no segments,
        // which is exactly the reader who sees every unrestricted entry and
        // nothing else.
        expect(next).toHaveBeenCalledTimes(1);
        expect(seen).toEqual({ tags: [], ids: 0 });
        // Logged, so an outage is visible rather than silently degrading.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('entitlement API down');
    });

    it('serves an anonymous reader when the resolver rejects [segments:I-35]', async () => {
        // The async half: `resolve` is awaited, so a rejected promise is the
        // shape a real adapter fails in far more often than a synchronous throw.
        const store = new ReaderStore();
        const middleware = new ReaderMiddleware(
            config(resolverOf({ rejects: new Error('timed out') })),
            catalogue(),
            store
        );

        let ids: ReadonlySet<string> | undefined;
        const next = jest.fn(() => {
            ids = store.current().segmentIds;
        }) as unknown as NextFunction;

        await middleware.use(REQUEST, RESPONSE, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(ids?.size).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    /**
     * The other side of the same claim, and what stops the test above passing
     * for the trivial reason that this middleware never resolves anybody: a
     * resolver that answers puts its tags — and the segments they resolve to —
     * in scope.
     */
    it('puts a resolved reader in scope for the rest of the request', async () => {
        const store = new ReaderStore();
        const middleware = new ReaderMiddleware(
            config(resolverOf({ tags: ['acme', 'acme-legacy'] })),
            catalogue(),
            store
        );

        let seen: { tags: readonly string[]; ids: string[] } | undefined;
        const next = jest.fn(() => {
            const reader = store.current();
            seen = { tags: reader.tags, ids: [...reader.segmentIds].sort() };
        }) as unknown as NextFunction;

        await middleware.use(REQUEST, RESPONSE, next);

        expect(seen).toEqual({
            tags: ['acme', 'acme-legacy'],
            ids: ['segment-for-acme', 'segment-for-acme-legacy']
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not reach the resolver at all while no segment exists', async () => {
        // The inert case every installation that has not used the feature is
        // in: no catalogue, no resolution, no `AsyncLocalStorage` scope.
        const resolve = jest.fn();
        const store = new ReaderStore();
        const middleware = new ReaderMiddleware(
            config({ resolve } as unknown as SegmentResolver<unknown>),
            catalogue(false),
            store
        );
        const next = jest.fn() as unknown as NextFunction;

        await middleware.use(REQUEST, RESPONSE, next);

        expect(resolve).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });
});
