import type { PoolClient } from 'pg';
import {
    DEFAULT_CONNECTION_TIMEOUT_MS,
    DEFAULT_POOL_MAX,
    getPool
} from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';

/**
 * The pool's limits, asserted because `pg`'s defaults for two of them are
 * "unbounded".
 *
 * A pool with no `connectionTimeoutMillis` does not fail when it runs out of
 * clients — it stops. The checkout queues on a promise that never settles, so
 * the request never answers, nothing is logged, and the process still looks
 * healthy. That failure mode is indistinguishable from a hang anywhere else in
 * the stack, which is why the bound is asserted here rather than assumed.
 */
describe('database connection pool limits', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });

    it('opens the pool with an explicit ceiling and an explicit wait [database:I-03]', () => {
        const options = getPool().options as {
            max?: number;
            connectionTimeoutMillis?: number;
        };
        expect(options.max).toBe(DEFAULT_POOL_MAX);
        expect(options.connectionTimeoutMillis).toBe(
            DEFAULT_CONNECTION_TIMEOUT_MS
        );
        expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
    });

    it('fails a checkout it cannot serve instead of waiting forever [database:I-03]', async () => {
        const pool = getPool();
        const held: PoolClient[] = [];
        try {
            for (let i = 0; i < DEFAULT_POOL_MAX; i += 1) {
                held.push(await pool.connect());
            }
            expect(pool.idleCount).toBe(0);

            const started = Date.now();
            await expect(pool.query('select 1')).rejects.toThrow(/timeout/i);
            // It waited — this is a bounded wait, not a refusal — and then gave
            // up somewhere near the configured bound rather than never.
            expect(Date.now() - started).toBeGreaterThanOrEqual(
                DEFAULT_CONNECTION_TIMEOUT_MS - 500
            );
        } finally {
            held.forEach((client) => client.release());
        }
    }, 25_000);

    it('serves the queue again as soon as a client comes back', async () => {
        const pool = getPool();
        const held: PoolClient[] = [];
        for (let i = 0; i < DEFAULT_POOL_MAX; i += 1) {
            held.push(await pool.connect());
        }
        const queued = pool.query('select 1 as ok');
        held.forEach((client) => client.release());

        await expect(queued).resolves.toMatchObject({
            rows: [{ ok: 1 }]
        });
    });
});
