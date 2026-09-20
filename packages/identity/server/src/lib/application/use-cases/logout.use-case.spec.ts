import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { SessionRepository } from '../../domain/session.repository';
import type { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';
import { LogoutUseCase } from './logout.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const TOKEN = 'c'.repeat(64);

/**
 * `LogoutUseCase` — identity:I-07: signing out revokes **only** the presented session
 * and always succeeds. The second half is the one worth pinning: an unknown or
 * already-revoked token is a no-op, and specifically a no-op that writes no
 * event — a phantom `auth.signed_out` for a session that was not live would put
 * sign-outs in the audit trail that never happened.
 *
 * Driven over test doubles for the ports; the use case's job is the ordering
 * and the transactional envelope.
 */
describe('LogoutUseCase', () => {
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

    interface Harness {
        useCase: LogoutUseCase;
        events: DomainEvent[];
        calls: string[];
        /** Every token handed to `revokeByToken`, in order. */
        revokedTokens: string[];
        /** Every user id handed to `revokeAllForUser`, in order. */
        revokedUsers: string[];
    }

    function harness(
        options: { revoked?: { userId: string } | null } = {}
    ): Harness {
        const events: DomainEvent[] = [];
        const calls: string[] = [];
        const revokedTokens: string[] = [];
        const revokedUsers: string[] = [];
        const revoked =
            options.revoked === undefined
                ? { userId: USER_ID }
                : options.revoked;

        const sessions = {
            revokeByToken: async (token: string) => {
                calls.push('sessions.revokeByToken');
                revokedTokens.push(token);
                return revoked;
            },
            revokeAllForUser: async (userId: string) => {
                revokedUsers.push(userId);
                return 0;
            }
        } as unknown as SessionRepository;

        const users = {
            emailById: async () => {
                calls.push('users.emailById');
                return EMAIL;
            }
        } as unknown as UserLookupQuery;

        return {
            useCase: new LogoutUseCase(
                fakeUow(calls),
                fakeOutbox(events, calls),
                users,
                sessions
            ),
            events,
            calls,
            revokedTokens,
            revokedUsers
        };
    }

    it('is a silent no-op when the token revoked nothing', async () => {
        // Idempotency: a second logout, or a logout with a stale cookie, must
        // succeed and leave no trace — no event, not even an actor lookup.
        const { useCase, events, calls } = harness({ revoked: null });

        await expect(useCase.execute(TOKEN)).resolves.toBeUndefined();

        expect(events).toEqual([]);
        expect(calls).toEqual([
            'uow.run:enter',
            'sessions.revokeByToken',
            'uow.run:exit'
        ]);
    });

    it('records one auth.signed_out carrying the actor when a session was revoked', async () => {
        const { useCase, events } = harness();

        await useCase.execute(TOKEN);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'auth.signed_out',
            aggregateType: 'user',
            aggregateId: USER_ID,
            payload: { actor: { id: USER_ID, email: EMAIL } }
        });
    });

    it('revokes the presented token alone, never the user’s other sessions', async () => {
        const { useCase, revokedTokens, revokedUsers } = harness();

        await useCase.execute(TOKEN);

        expect(revokedTokens).toEqual([TOKEN]);
        expect(revokedUsers).toEqual([]);
    });

    it('writes the event inside the same unit of work as the revocation', async () => {
        // The event commits iff the revocation does; a sign-out recorded
        // outside the transaction could survive a rollback.
        const { useCase, calls } = harness();

        await useCase.execute(TOKEN);

        expect(calls).toEqual([
            'uow.run:enter',
            'sessions.revokeByToken',
            'users.emailById',
            'outbox.append',
            'uow.run:exit'
        ]);
    });
});
