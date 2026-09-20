import { createHash } from 'node:crypto';
import { Column, Param, SQL, StringChunk } from 'drizzle-orm';
import type { Database } from '@orthacms/database';
import type { IdentityPluginConfig } from '@orthacms/identity-server';
import { InviteRecentlySentError } from '../../domain/errors';
import { InviteTokenService } from './invite-token.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INVITE_TTL_SECONDS = 604_800;
const RESET_TTL_SECONDS = 3_600;
const NOW = new Date('2026-08-29T12:00:00.000Z');

/** The advisory-lock namespace this service must emit — "INVT". */
const INVITE_LOCK_NAMESPACE = 0x494e5654;
/** Its sibling's, which it must never emit. */
const RESET_LOCK_NAMESPACE = 0x52534554;

/** The executor `rotate` accepts (its own type is module-private). */
type TokenExecutor = Parameters<InviteTokenService['rotate']>[1];

/** One statement the double saw, in the order `rotate` issued it. */
type Statement =
    | { kind: 'lock'; params: unknown[] }
    | { kind: 'select'; where: unknown }
    | { kind: 'delete'; where: unknown }
    | { kind: 'insert'; values: Record<string, unknown> };

/**
 * The interpolated values of a drizzle fragment, in order — the structural
 * chunks (literal SQL, column references) dropped. It is the only way to see
 * *what a predicate is scoped to* without a database.
 */
function paramsOf(node: unknown, out: unknown[] = []): unknown[] {
    if (node instanceof Param) {
        out.push(node.value);
    } else if (node instanceof SQL) {
        for (const chunk of node.queryChunks) {
            paramsOf(chunk, out);
        }
    } else if (node instanceof StringChunk || node instanceof Column) {
        // Structure, not data.
    } else if (Array.isArray(node)) {
        for (const item of node) {
            paramsOf(item, out);
        }
    } else {
        out.push(node);
    }
    return out;
}

/**
 * `InviteTokenService.rotate` — the ordering and scoping properties that make
 * "at most one live invite per user" true.
 *
 * Every one of these is invisible in an integration test that just checks a
 * fresh token comes back: the lock could be taken *after* the cooldown read,
 * the delete could be missing its `type` predicate and wipe the member's
 * password-reset token too, and the raw token could be stored alongside its
 * hash — and the endpoint would still answer 200 with a working link. A
 * recording executor is what makes the sequence itself assertable.
 */
describe('InviteTokenService.rotate', () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** An executor that records every statement instead of running it. */
    function executorDouble(current?: { createdAt: Date }) {
        const statements: Statement[] = [];
        const executor = {
            execute: async (fragment: unknown) => {
                statements.push({ kind: 'lock', params: paramsOf(fragment) });
            },
            select: () => ({
                from: () => ({
                    where: (where: unknown) => ({
                        limit: async () => {
                            statements.push({ kind: 'select', where });
                            return current ? [current] : [];
                        }
                    })
                })
            }),
            delete: () => ({
                where: async (where: unknown) => {
                    statements.push({ kind: 'delete', where });
                }
            }),
            insert: () => ({
                values: async (values: Record<string, unknown>) => {
                    statements.push({ kind: 'insert', values });
                }
            })
        };
        return {
            statements,
            executor: executor as unknown as TokenExecutor,
            /** The kinds seen so far, in order. */
            kinds: () => statements.map((statement) => statement.kind),
            /** The single statement of `kind`, or `undefined`. */
            one: <K extends Statement['kind']>(kind: K) =>
                statements.find(
                    (statement): statement is Extract<Statement, { kind: K }> =>
                        statement.kind === kind
                )
        };
    }

    /** The service under a config whose two TTLs differ. */
    function service(): InviteTokenService {
        const config = {
            token: {
                inviteTtlSeconds: INVITE_TTL_SECONDS,
                resetTtlSeconds: RESET_TTL_SECONDS
            }
        } as IdentityPluginConfig;
        const db = {
            transaction: async (run: (tx: unknown) => Promise<void>) => {
                throw new Error(
                    `rotate opened its own transaction instead of joining the caller's: ${run.name}`
                );
            }
        } as unknown as Database;
        return new InviteTokenService(db, config);
    }

    it('takes the advisory lock before touching any row [users:I-04]', async () => {
        const double = executorDouble();

        await service().rotate(USER_ID, double.executor);

        expect(double.kinds()).toEqual(['lock', 'delete', 'insert']);
    });

    it('locks in the invite namespace, not the reset one', async () => {
        const double = executorDouble();

        await service().rotate(USER_ID, double.executor);

        // Sharing a namespace with the reset service would make a reset for one
        // person queue behind an invite rotation for another whose id hashes
        // the same way — the exact coupling the two constants exist to avoid.
        expect(double.one('lock')?.params).toEqual([
            INVITE_LOCK_NAMESPACE,
            USER_ID
        ]);
        expect(double.one('lock')?.params).not.toContain(RESET_LOCK_NAMESPACE);
    });

    it('scopes the delete to this user’s invite rows only', async () => {
        const double = executorDouble();

        await service().rotate(USER_ID, double.executor);

        // Without the `type` predicate the rotation would also destroy the
        // member's live password-reset token, which lives in the same table.
        expect(paramsOf(double.one('delete')?.where)).toEqual([
            USER_ID,
            'invite'
        ]);
    });

    it('stores only the SHA-256, and returns the raw token exactly once [users:I-05]', async () => {
        const double = executorDouble();

        const { raw, expiresAt } = await service().rotate(
            USER_ID,
            double.executor
        );

        const inserted = double.one('insert')?.values ?? {};
        // The expiry comes back with the secret so the caller — the mail
        // queue — pins the message to the same instant this row was written,
        // rather than recomputing it from the TTL a refactor away from
        // disagreeing.
        expect(inserted['expiresAt']).toEqual(expiresAt);
        expect(inserted['tokenHash']).toBe(
            createHash('sha256').update(raw).digest('hex')
        );
        expect(inserted['tokenHash']).not.toBe(raw);
        // Nothing else in the row may carry the secret in readable form.
        expect(JSON.stringify(inserted)).not.toContain(raw);
        expect(inserted).toMatchObject({ type: 'invite', userId: USER_ID });
    });

    it('computes the expiry from the invite TTL, not the reset TTL', async () => {
        const double = executorDouble();

        await service().rotate(USER_ID, double.executor);

        // A copy-paste swap between the two services is silent otherwise: both
        // still mint a working token, just with the wrong lifetime.
        expect(double.one('insert')?.values['expiresAt']).toEqual(
            new Date(NOW.getTime() + INVITE_TTL_SECONDS * 1000)
        );
    });

    it('reads no current token when no cooldown is asked for', async () => {
        const double = executorDouble({ createdAt: new Date(NOW) });

        await service().rotate(USER_ID, double.executor);

        // The first-invite path: there is nothing to protect, so it does not
        // pay for the read.
        expect(double.kinds()).not.toContain('select');
    });

    it('refuses a rotation inside the cooldown, having already taken the lock [users:I-06]', async () => {
        const double = executorDouble({
            createdAt: new Date(NOW.getTime() - 10_000)
        });

        const thrown = await service()
            .rotate(USER_ID, double.executor, { minIntervalSeconds: 60 })
            .then(
                () => null,
                (error: unknown) => error
            );

        expect(thrown).toBeInstanceOf(InviteRecentlySentError);
        expect((thrown as InviteRecentlySentError).retryAfterSeconds).toBe(50);
        // The pairing is the point: the window was read *under* the lock, and
        // nothing was destroyed. A check outside the lock would let two
        // concurrent resends both read "no recent token" and both rotate.
        expect(double.kinds()).toEqual(['lock', 'select']);
    });

    it('rotates once the cooldown has elapsed', async () => {
        const double = executorDouble({
            createdAt: new Date(NOW.getTime() - 61_000)
        });

        await service().rotate(USER_ID, double.executor, {
            minIntervalSeconds: 60
        });

        expect(double.kinds()).toEqual(['lock', 'select', 'delete', 'insert']);
    });

    it('scopes the cooldown read to this user’s invite rows', async () => {
        const double = executorDouble();

        await service().rotate(USER_ID, double.executor, {
            minIntervalSeconds: 60
        });

        expect(paramsOf(double.one('select')?.where)).toEqual([
            USER_ID,
            'invite'
        ]);
    });
});
