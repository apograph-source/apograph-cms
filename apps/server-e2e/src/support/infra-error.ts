import { getPool } from '@orthacms/database';

/**
 * Telling "the database went away" apart from "the code is wrong".
 *
 * Every suite in this run shares one Postgres testcontainer. When that
 * container dies mid-run — on a developer box the usual cause is memory
 * pressure killing it, or Docker itself — every remaining suite fails in its
 * own `beforeAll`/`beforeEach`, each with a different-looking error:
 *
 *     ● API token management › mints a token and returns the plaintext once
 *       AggregateError
 *         at ../../node_modules/pg-pool/index.js:45:11
 *         at async seedSystemRoles (…/seed-system-roles.ts:43:5)
 *
 * Nothing in ~650 lines of that says the database is gone, so the run reads as
 * a catastrophic product regression. This module makes it say so.
 */

/**
 * Thrown instead of the raw driver error when the test database is unreachable.
 *
 * A distinct class so a reader (and a `catch`) can tell an infrastructure
 * failure from an assertion failure without pattern-matching on strings.
 */
export class E2eInfrastructureError extends Error {
    override readonly name = 'E2eInfrastructureError';
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        // The specs run through SWC in `loose` mode, which does not reliably
        // keep the prototype chain when extending a builtin — without this,
        // `instanceof E2eInfrastructureError` is false and the class stops being
        // the thing that distinguishes infrastructure from assertions.
        Object.setPrototypeOf(this, E2eInfrastructureError.prototype);
    }
}

/**
 * Driver/OS codes that mean "no usable connection", never "bad query".
 *
 * The `08xxx` / `57Pxx` entries are Postgres SQLSTATEs (connection exception,
 * admin shutdown); the rest are libuv socket errnos. `EINVAL` is here because
 * `pg-protocol` raises `write EINVAL` when the socket goes away underneath a
 * write, which is what a vanishing container looks like from inside a query.
 */
const UNREACHABLE_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'EINVAL',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '08007',
    '57P01',
    '57P02',
    '57P03'
]);

/** Driver messages that carry no code but mean the same thing. */
const UNREACHABLE_MESSAGES = [
    'connection terminated',
    'connection ended unexpectedly',
    'is not queryable',
    'timeout exceeded when trying to connect',
    'the database system is shutting down',
    'the database system is starting up',
    'terminating connection',
    'cannot use a pool after calling end',
    'server closed the connection unexpectedly'
];

/** The error-ish shape this module reads. Deliberately not `Error`. */
interface ErrorLike {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    errors?: unknown;
    cause?: unknown;
}

/**
 * Walk `cause` chains and `AggregateError.errors`, which pg-pool produces.
 *
 * Duck-typed rather than `instanceof Error` on purpose: the driver's errors are
 * constructed inside `node_modules/pg`, and under Jest's sandboxed module
 * registry those do **not** satisfy `instanceof Error` against the realm the
 * spec sees. An `instanceof` check here silently classified every real pg
 * failure as "not infrastructure" — the exact bug this module exists to prevent,
 * committed by the module itself.
 */
function* flatten(
    error: unknown,
    seen = new Set<unknown>()
): Generator<ErrorLike> {
    if (typeof error !== 'object' || error === null || seen.has(error)) return;
    seen.add(error);
    const errorLike = error as ErrorLike;
    yield errorLike;
    if (Array.isArray(errorLike.errors)) {
        for (const inner of errorLike.errors) yield* flatten(inner, seen);
    }
    yield* flatten(errorLike.cause, seen);
}

/**
 * Whether `error` (or anything it wraps) means the test database is unreachable.
 *
 * A bare `AggregateError` with no code and no message counts: that is precisely
 * what `pg-pool` throws when every address it tried failed, and it is the shape
 * seen in the wild.
 */
export function isDatabaseUnreachable(error: unknown): boolean {
    for (const inner of flatten(error)) {
        const { code, name } = inner;
        if (typeof code === 'string' && UNREACHABLE_CODES.has(code))
            return true;

        const message =
            typeof inner.message === 'string'
                ? inner.message.toLowerCase()
                : '';
        if (UNREACHABLE_MESSAGES.some((needle) => message.includes(needle))) {
            return true;
        }

        // pg-pool's "all candidate addresses failed" AggregateError: no code, no
        // message, only an (often empty) `errors` array.
        if (name === 'AggregateError' && Array.isArray(inner.errors)) {
            return true;
        }
    }
    return false;
}

function describe(error: unknown): string {
    for (const inner of flatten(error)) {
        const { code, message } = inner;
        if (typeof message === 'string' && message.length > 0) {
            return typeof code === 'string' ? `${message} (${code})` : message;
        }
        if (typeof code === 'string') return code;
    }
    return String(error);
}

function infrastructureError(
    what: string,
    error: unknown
): E2eInfrastructureError {
    return new E2eInfrastructureError(
        'THE TEST DATABASE IS UNREACHABLE — this is an infrastructure failure, not a test failure.\n\n' +
            `  while: ${what}\n` +
            `  cause: ${describe(error)}\n\n` +
            'The Postgres testcontainer this run shares is gone or refusing connections.\n' +
            'On a developer machine the usual reason is memory pressure: the container (or\n' +
            'the Docker daemon) is killed, and every remaining suite then fails in its own\n' +
            'setup with an error that looks like a product bug.\n\n' +
            'Do NOT read the rest of this run as regressions. Check `docker ps`, free memory,\n' +
            'and re-run.',
        { cause: error }
    );
}

/**
 * Run `fn`, and re-label a connectivity failure as an infrastructure error.
 *
 * Anything else is rethrown untouched — an assertion failure must stay an
 * assertion failure, or this helper would hide the bugs it exists to expose.
 */
export async function withDatabaseDiagnostics<T>(
    what: string,
    fn: () => Promise<T>
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof E2eInfrastructureError) throw error;
        if (isDatabaseUnreachable(error))
            throw infrastructureError(what, error);
        throw error;
    }
}

/**
 * Cheapest possible liveness probe on the shared pool.
 *
 * Called once per booted app, before Nest instantiates a single provider, so a
 * dead container is reported as one clear line rather than as whatever the
 * first bootstrap seeder happened to be doing when it noticed.
 */
export async function assertDatabaseReachable(): Promise<void> {
    await withDatabaseDiagnostics(
        'connecting to the test database',
        async () => {
            await getPool().query('SELECT 1');
        }
    );
}
