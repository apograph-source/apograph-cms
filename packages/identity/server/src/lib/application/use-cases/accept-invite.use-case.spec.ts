import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { HashingService } from '../../auth/services/hashing.service';
import { InvalidInviteTokenError } from '../../domain/errors';
import type {
    InviteRepository,
    PendingInvite
} from '../../domain/invite.repository';
import type {
    CreatedSession,
    SessionRepository
} from '../../domain/session.repository';
import { UserAccount } from '../../domain/user-account';
import type { UserAccountRepository } from '../../domain/user-account.repository';
import { AcceptInviteUseCase } from './accept-invite.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const TOKEN_ID = '22222222-2222-4222-8222-222222222222';
const RAW_TOKEN = 'e'.repeat(64);
const HASH = `$2b$12$${'a'.repeat(53)}`;

/**
 * `AcceptInviteUseCase` — redeeming a one-time invite link. Three invariants
 * meet here: the link burns exactly once even under a concurrent accept
 * (identity:I-05), every reason it can fail collapses into one
 * indistinguishable error (identity:I-04), and the raw token never reaches
 * the repository — only its SHA-256 does (identity:I-09).
 *
 * The tests are about **call ordering and call absence** as much as results: a
 * bogus link must cost no bcrypt, and a lost race must not save an account.
 * Driven over test doubles for the ports with the real {@link UserAccount}
 * aggregate, since its `pending` guard is part of what is being asserted.
 */
describe('AcceptInviteUseCase', () => {
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

    function pendingInvite(): PendingInvite {
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
        useCase: AcceptInviteUseCase;
        events: DomainEvent[];
        calls: string[];
        /** Every token hash handed to the invite lookup, in order. */
        lookups: string[];
        saved: UserAccount[];
        /** Every user id handed to `sessions.issue`, in order. */
        issued: string[];
    }

    function harness(
        options: {
            invite?: PendingInvite | null;
            consumed?: boolean;
            account?: UserAccount | null;
        } = {}
    ): Harness {
        const events: DomainEvent[] = [];
        const calls: string[] = [];
        const lookups: string[] = [];
        const saved: UserAccount[] = [];
        const issued: string[] = [];
        const invite =
            options.invite === undefined ? pendingInvite() : options.invite;
        const found =
            options.account === undefined
                ? account('pending')
                : options.account;

        const hashing = {
            // A stand-in digest that is visibly not the raw token, so a test
            // can tell which of the two reached the repository.
            hashToken: (raw: string) => `sha256:${raw}`,
            hashPassword: async () => {
                calls.push('hashing.hashPassword');
                return HASH;
            }
        } as unknown as HashingService;

        const invites = {
            findPendingByTokenHash: async (tokenHash: string) => {
                calls.push('invites.findPendingByTokenHash');
                lookups.push(tokenHash);
                return invite;
            },
            consume: async () => {
                calls.push('invites.consume');
                return options.consumed ?? true;
            }
        } as unknown as InviteRepository;

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
            issue: async (userId: string): Promise<CreatedSession> => {
                calls.push('sessions.issue');
                issued.push(userId);
                return { token: 'b'.repeat(64), expiresAt: new Date() };
            }
        } as unknown as SessionRepository;

        return {
            useCase: new AcceptInviteUseCase(
                fakeUow(calls),
                fakeOutbox(events, calls),
                hashing,
                invites,
                accounts,
                sessions
            ),
            events,
            calls,
            lookups,
            saved,
            issued
        };
    }

    it('rejects the loser of a concurrent accept without saving the account [identity:I-05]', async () => {
        // identity:I-05: `consume` is the conditional write that makes the link
        // one-time. The call that gets `false` lost the race, and must leave
        // the account exactly as it found it.
        const { useCase, calls, saved, issued, events } = harness({
            consumed: false
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidInviteTokenError);

        expect(saved).toEqual([]);
        expect(issued).toEqual([]);
        expect(events).toEqual([]);
        expect(calls).not.toContain('accounts.findById');
    });

    it('spends no bcrypt on a token that resolves to nothing', async () => {
        // An unusable link is rejected for the price of one indexed lookup —
        // otherwise anyone could burn ~250ms of CPU per junk token they post.
        const { useCase, calls } = harness({ invite: null });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidInviteTokenError);

        expect(calls).not.toContain('hashing.hashPassword');
        expect(calls).not.toContain('invites.consume');
    });

    it('rejects a live token whose account has vanished, indistinguishably', async () => {
        const { useCase, saved, issued } = harness({ account: null });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidInviteTokenError);

        expect(saved).toEqual([]);
        expect(issued).toEqual([]);
    });

    it('rejects a live token whose account is already active, indistinguishably [identity:I-04]', async () => {
        // identity:I-04: "already accepted" and "never existed" are the same 404. An
        // account that is not `pending` cannot be activated a second time.
        const { useCase, saved, issued } = harness({
            account: account('active')
        });

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).rejects.toBeInstanceOf(InvalidInviteTokenError);

        expect(saved).toEqual([]);
        expect(issued).toEqual([]);
    });

    it('looks the invite up by digest, never by the raw token [identity:I-09]', async () => {
        // identity:I-09: the token in the emailed link is a bearer credential; only its
        // SHA-256 is ever stored or matched.
        const { useCase, lookups } = harness();

        await useCase.execute(RAW_TOKEN, 'a new passphrase');

        expect(lookups).toEqual([`sha256:${RAW_TOKEN}`]);
        expect(lookups).not.toContain(RAW_TOKEN);
    });

    it('activates, opens a session, and records activation before sign-in', async () => {
        // The invitee lands signed in rather than at a login form, and the
        // audit trail reads in the order the facts happened.
        const { useCase, calls, saved, issued, events } = harness();

        await expect(
            useCase.execute(RAW_TOKEN, 'a new passphrase')
        ).resolves.toMatchObject({ token: expect.any(String) });

        expect(calls).toEqual([
            'uow.run:enter',
            'invites.findPendingByTokenHash',
            'invites.consume',
            'accounts.findById',
            'hashing.hashPassword',
            'accounts.save',
            'sessions.issue',
            'outbox.append',
            'uow.run:exit'
        ]);
        expect(saved).toHaveLength(1);
        expect(saved[0].status.isActive).toBe(true);
        expect(issued).toEqual([USER_ID]);

        expect(events.map((event) => event.kind)).toEqual([
            'user.activated',
            'auth.signed_in'
        ]);
        for (const event of events) {
            expect(event.payload).toMatchObject({
                actor: { id: USER_ID, email: EMAIL }
            });
        }
    });
});
