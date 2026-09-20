import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { HashingService } from '../../auth/services/hashing.service';
import { InvalidResetTokenError } from '../../domain/errors';
import type {
    PasswordResetRepository,
    PendingPasswordReset
} from '../../domain/password-reset.repository';
import type { SessionRepository } from '../../domain/session.repository';
import { UserAccount } from '../../domain/user-account';
import type { UserAccountRepository } from '../../domain/user-account.repository';
import { ResetPasswordUseCase } from './reset-password.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const RAW_TOKEN = 'd'.repeat(64);
const HASH = `$2b$12$${'a'.repeat(53)}`;

/**
 * `ResetPasswordUseCase` — redeeming a password-reset link. What the ordering
 * assertions here protect is a pair of costs the flow deliberately balances:
 * bcrypt at cost 12 takes ~250ms, so it runs **outside** the transaction (or it
 * would pin a connection and hold a row lock for a quarter-second per reset),
 * but **after** the advisory token read (or anyone could spend that CPU with a
 * junk link). Only a call log can show that, so the harness records one.
 *
 * The other two invariants: redeeming revokes every live session and issues
 * none (identity:I-06 — a session is a bearer credential the *old* password opened, and
 * someone holding only a link should land back at the sign-in form), and every
 * failure mode collapses into one indistinguishable error (identity:I-04,
 * identity:I-05).
 */
describe('ResetPasswordUseCase', () => {
    /** A `UnitOfWork` that simply runs the callback — one logical transaction. */
    function fakeUow(calls: string[]): UnitOfWork {
        return {
            run: async (fn: () => Promise<unknown>) => {
                calls.push('uow.run:enter');
                const result = await fn();
                calls.push('uow.run:exit');
                return result;
            }
        } as UnitOfWork;
    }

    function fakeOutbox(sink: DomainEvent[], calls: string[]): OutboxWriter {
        return {
            append: async (events: DomainEvent[]) => {
                calls.push('outbox.append');
                sink.push(...events);
            }
        } as OutboxWriter;
    }

    function pendingReset(): PendingPasswordReset {
        return {
            tokenId: TOKEN_ID,
            userId: USER_ID,
            email: EMAIL,
            name: 'Ada Lovelace'
        };
    }

    function account(status: string): UserAccount {
        return UserAccount.rehydrate({
            id: USER_ID,
            email: EMAIL,
            status,
            passwordHash: status === 'pending' ? null : HASH
        });
    }

    interface Harness {
        useCase: ResetPasswordUseCase;
        events: DomainEvent[];
        calls: string[];
        /** Every token hash handed to the reset lookup, in order. */
        lookups: string[];
        saved: UserAccount[];
        /** Every user id whose sessions were revoked wholesale, in order. */
        revokedUsers: string[];
        /** Every user id handed to `sessions.issue`, in order. */
        issued: string[];
    }

    function harness(
        options: {
            reset?: PendingPasswordReset | null;
            consumed?: boolean;
            account?: UserAccount | null;
            revoked?: number;
        } = {}
    ): Harness {
        const events: DomainEvent[] = [];
        const calls: string[] = [];
        const lookups: string[] = [];
        const saved: UserAccount[] = [];
        const revokedUsers: string[] = [];
        const issued: string[] = [];
        const reset =
            options.reset === undefined ? pendingReset() : options.reset;
        const found =
            options.account === undefined ? account('active') : options.account;

        const hashing = {
            hashToken: (raw: string) => `sha256:${raw}`,
            hashPassword: async () => {
                // Genuinely asynchronous, so "started" and "finished" are
                // distinguishable points in the log — a synchronous double
                // would make the ordering assertion vacuous.
                calls.push('hashing.hashPassword:start');
                await Promise.resolve();
                calls.push('hashing.hashPassword:end');
                return HASH;
            }
        } as unknown as HashingService;

        const resets = {
            findPendingByTokenHash: async (tokenHash: string) => {
                calls.push('resets.findPendingByTokenHash');
                lookups.push(tokenHash);
                return reset;
            },
            consume: async () => {
                calls.push('resets.consume');
                return options.consumed ?? true;
            }
        } as unknown as PasswordResetRepository;

        const accounts = {
            findById: async () => {
                calls.push('accounts.findById');
                return found;
            },
            save: async (a: UserAccount) => {
                calls.push('accounts.save');
                saved.push(a);
            }
        } as unknown as UserAccountRepository;

        const sessions = {
            revokeAllForUser: async (userId: string) => {
                calls.push('sessions.revokeAllForUser');
                revokedUsers.push(userId);
                return options.revoked ?? 0;
            },
            issue: async (userId: string) => {
                calls.push('sessions.issue');
                issued.push(userId);
                return { token: 'b'.repeat(64), expiresAt: new Date() };
            }
        } as unknown as SessionRepository;

        return {
            useCase: new ResetPasswordUseCase(
                fakeUow(calls),
                fakeOutbox(events, calls),
                hashing,
                resets,
                accounts,
                sessions
            ),
            events,
            calls,
            lookups,
            saved,
            revokedUsers,
            issued
        };
    }

    it('rejects a dead link before any hashing and before opening a transaction', async () => {
        // The advisory pre-check: a bogus token costs one indexed lookup, not
        // ~250ms of bcrypt and a transaction.
        const { useCase, calls, lookups } = harness({ reset: null });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidResetTokenError);

        expect(calls).toEqual(['resets.findPendingByTokenHash']);
        // identity:I-09: the digest is what the repository sees, never the raw token.
        expect(lookups).toEqual([`sha256:${RAW_TOKEN}`]);
    });

    it('finishes hashing before the transaction opens', async () => {
        // bcrypt inside the unit of work would pin a connection and hold the
        // token's row lock for the whole ~250ms.
        const { useCase, calls } = harness();

        await useCase.execute(RAW_TOKEN, 'a new passphrase');

        const hashed = calls.indexOf('hashing.hashPassword:end');
        const opened = calls.indexOf('uow.run:enter');
        expect(hashed).toBeGreaterThanOrEqual(0);
        expect(opened).toBeGreaterThan(hashed);
    });

    it('rejects the loser of a concurrent submission without saving anything [identity:I-05]', async () => {
        // identity:I-05: the read above is advisory; the conditional `consume` is what
        // actually makes the link one-time, and the loser stops here.
        const { useCase, calls, saved, revokedUsers, events } = harness({
            consumed: false
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidResetTokenError);

        expect(saved).toEqual([]);
        expect(revokedUsers).toEqual([]);
        expect(events).toEqual([]);
        expect(calls).not.toContain('accounts.findById');
    });

    it('refuses a pending account, indistinguishably from a dead link', async () => {
        // A `pending` account has no credential to rotate — it is finished
        // through the invite flow.
        const { useCase, saved, revokedUsers } = harness({
            account: account('pending')
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidResetTokenError);

        expect(saved).toEqual([]);
        expect(revokedUsers).toEqual([]);
    });

    it('refuses a disabled account, indistinguishably from a dead link', async () => {
        // Resetting one would quietly restore a sign-in path an admin
        // deliberately closed.
        const { useCase, saved, revokedUsers } = harness({
            account: account('disabled')
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidResetTokenError);

        expect(saved).toEqual([]);
        expect(revokedUsers).toEqual([]);
    });

    it('evicts every live session and opens none, reporting the count [identity:I-06]', async () => {
        // identity:I-06. The count rides on the event so the audit row can state it —
        // the aggregate raised the fact without it, having no idea sessions
        // exist.
        const { useCase, revokedUsers, issued, events } = harness({
            revoked: 4
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).resolves.toBe(4);

        expect(revokedUsers).toEqual([USER_ID]);
        expect(issued).toEqual([]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'user.password_changed',
            aggregateType: 'user',
            aggregateId: USER_ID,
            payload: {
                sessionsRevoked: 4,
                actor: { id: USER_ID, email: EMAIL }
            }
        });
    });
});
