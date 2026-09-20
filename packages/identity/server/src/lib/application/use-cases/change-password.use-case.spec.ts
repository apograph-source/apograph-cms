import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import { ChangePasswordUseCase } from './change-password.use-case';
import { UserAccount } from '../../domain/user-account';
import { UserAccountNotFoundError } from '../../domain/errors';
import type { UserAccountRepository } from '../../domain/user-account.repository';
import type { SessionRepository } from '../../domain/session.repository';
import type { HashingService } from '../../auth/services/hashing.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const HASH = `$2b$12$${'a'.repeat(53)}`;

/**
 * `ChangePasswordUseCase` — the credential-rotation flow. The invariant under
 * test is that rotating a credential also evicts what the previous credential
 * authorized (BUG-identity-server-05: it changed the hash and left every
 * session live for its full TTL), and that the fact reaches the outbox where
 * the audit subscriber can record it.
 *
 * Driven over test doubles for the ports — the use case's job is the ordering
 * and the transactional envelope, both of which are DB-free decisions.
 */
describe('ChangePasswordUseCase', () => {
    /** A `UnitOfWork` that simply runs the callback — one logical transaction. */
    function fakeUow(): UnitOfWork {
        return { run: (fn: () => Promise<unknown>) => fn() } as UnitOfWork;
    }

    function fakeOutbox(sink: DomainEvent[]): OutboxWriter {
        return {
            append: async (events: DomainEvent[]) => {
                sink.push(...events);
            }
        } as OutboxWriter;
    }

    function activeAccount(): UserAccount {
        return UserAccount.rehydrate({
            id: USER_ID,
            email: EMAIL,
            status: 'active',
            passwordHash: HASH
        });
    }

    interface Harness {
        useCase: ChangePasswordUseCase;
        events: DomainEvent[];
        revokeCalls: { userId: string; exceptSessionId?: string }[];
        saved: UserAccount[];
    }

    function harness(
        options: { account?: UserAccount | null; revoked?: number } = {}
    ): Harness {
        const events: DomainEvent[] = [];
        const revokeCalls: Harness['revokeCalls'] = [];
        const saved: UserAccount[] = [];
        const account =
            options.account === undefined ? activeAccount() : options.account;

        const accounts = {
            findById: async () => account,
            save: async (a: UserAccount) => {
                saved.push(a);
            }
        } as unknown as UserAccountRepository;

        const sessions = {
            revokeAllForUser: async (
                userId: string,
                opts: { exceptSessionId?: string } = {}
            ) => {
                revokeCalls.push({
                    userId,
                    exceptSessionId: opts.exceptSessionId
                });
                return options.revoked ?? 0;
            }
        } as unknown as SessionRepository;

        const hashing = {
            hashPassword: async () => HASH
        } as unknown as HashingService;

        return {
            useCase: new ChangePasswordUseCase(
                fakeUow(),
                fakeOutbox(events),
                hashing,
                accounts,
                sessions
            ),
            events,
            revokeCalls,
            saved
        };
    }

    it('revokes every live session the old password had opened', async () => {
        const { useCase, revokeCalls } = harness({ revoked: 3 });

        const revoked = await useCase.execute(USER_ID, 'a new passphrase');

        expect(revoked).toBe(3);
        expect(revokeCalls).toEqual([
            { userId: USER_ID, exceptSessionId: undefined }
        ]);
    });

    it('spares the caller’s own session when one is named', async () => {
        // The self-service case: changing your password from a signed-in device
        // must not sign you out of the device you are standing at.
        const { useCase, revokeCalls } = harness({ revoked: 2 });

        await useCase.execute(USER_ID, 'a new passphrase', {
            keepSessionId: 'b'.repeat(64)
        });

        expect(revokeCalls).toEqual([
            { userId: USER_ID, exceptSessionId: 'b'.repeat(64) }
        ]);
    });

    it('emits user.password_changed carrying the actor and the eviction count', async () => {
        const { useCase, events } = harness({ revoked: 4 });

        await useCase.execute(USER_ID, 'a new passphrase');

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

    it('persists the new credential before the revocation is decided', async () => {
        const { useCase, saved } = harness();

        await useCase.execute(USER_ID, 'a new passphrase');

        expect(saved).toHaveLength(1);
        expect(saved[0].changes().credentialChanged).toBe(true);
    });

    it('throws for an unknown account, revoking nothing', async () => {
        const { useCase, revokeCalls, events } = harness({ account: null });

        await expect(
            useCase.execute(USER_ID, 'a new passphrase')
        ).rejects.toBeInstanceOf(UserAccountNotFoundError);
        expect(revokeCalls).toEqual([]);
        expect(events).toEqual([]);
    });

    it('refuses to change the credential of a disabled account', async () => {
        // The aggregate's invariant. It matters here because a disabled
        // account's sessions were already revoked when it was disabled — a
        // credential change must not be the thing that quietly re-opens it.
        const disabled = UserAccount.rehydrate({
            id: USER_ID,
            email: EMAIL,
            status: 'disabled',
            passwordHash: HASH
        });
        const { useCase, revokeCalls, events } = harness({ account: disabled });

        await expect(
            useCase.execute(USER_ID, 'a new passphrase')
        ).rejects.toThrow();
        expect(revokeCalls).toEqual([]);
        expect(events).toEqual([]);
    });
});
