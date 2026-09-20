import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import { InvalidCredentialsError } from '../../auth/errors';
import type { HashingService } from '../../auth/services/hashing.service';
import type {
    CreatedSession,
    SessionRepository
} from '../../domain/session.repository';
import type {
    AuthCredentials,
    UserLookupQuery
} from '../../infrastructure/queries/user-lookup.query';
import type { IdentityPluginConfig } from '../../types';
import { LoginUseCase } from './login.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const HASH = `$2b$12$${'a'.repeat(53)}`;
const DUMMY_HASH = `$2b$12$${'z'.repeat(53)}`;
const PASSWORD = 'a correct horse battery staple';

/** The slice of the plugin config this flow actually reads. */
interface LoginConfig {
    sso?: { allowPasswordLogin?: boolean };
    rootAdmin?: { email?: string };
}

/**
 * `LoginUseCase` — identity:I-03: every reason a sign-in fails is indistinguishable,
 * both in the response and in the time it takes. That second clause is what
 * makes these tests about **call counts and ordering** rather than return
 * values: the flow must run exactly one bcrypt comparison on every path,
 * including the paths where there is nothing to compare against (no account, a
 * `pending` account with a null hash) and the path where passwords are switched
 * off entirely. A path that returned early would be a timing oracle for
 * enumerating accounts.
 *
 * Driven over test doubles for the ports — the decisions under test are the
 * ordering, the equalization, and the transactional envelope, all DB-free.
 */
describe('LoginUseCase', () => {
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

    function credentials(
        overrides: Partial<AuthCredentials> = {}
    ): AuthCredentials {
        return {
            userId: USER_ID,
            email: EMAIL,
            passwordHash: HASH,
            status: 'active',
            ...overrides
        };
    }

    interface Harness {
        useCase: LoginUseCase;
        events: DomainEvent[];
        calls: string[];
        /** Every `verifyPassword` call, in order — the timing-equalizer's log. */
        verifications: { hashed: string; plain: string }[];
        /** Every email handed to the credentials lookup, in order. */
        lookups: string[];
        /** Every `issue` call, in order. */
        issued: string[];
        /** How many times the throwaway dummy hash was computed. */
        hashCount: () => number;
    }

    function harness(
        options: {
            user?: AuthCredentials | null;
            passwordOk?: boolean;
            config?: LoginConfig;
        } = {}
    ): Harness {
        const events: DomainEvent[] = [];
        const calls: string[] = [];
        const verifications: Harness['verifications'] = [];
        const lookups: string[] = [];
        const issued: string[] = [];
        let hashCount = 0;
        const user = options.user === undefined ? credentials() : options.user;

        const users = {
            credentialsByEmail: async (email: string) => {
                calls.push('users.credentialsByEmail');
                lookups.push(email);
                return user;
            }
        } as unknown as UserLookupQuery;

        const hashing = {
            hashPassword: async () => {
                hashCount += 1;
                calls.push('hashing.hashPassword');
                return DUMMY_HASH;
            },
            verifyPassword: async (hashed: string, plain: string) => {
                calls.push('hashing.verifyPassword');
                verifications.push({ hashed, plain });
                return options.passwordOk ?? true;
            }
        } as unknown as HashingService;

        const sessions = {
            issue: async (userId: string): Promise<CreatedSession> => {
                calls.push('sessions.issue');
                issued.push(userId);
                return { token: 'b'.repeat(64), expiresAt: new Date() };
            }
        } as unknown as SessionRepository;

        const config = {
            allowedOrigins: [],
            ...options.config
        } as unknown as IdentityPluginConfig;

        return {
            useCase: new LoginUseCase(
                fakeUow(calls),
                fakeOutbox(events, calls),
                users,
                hashing,
                sessions,
                config
            ),
            events,
            calls,
            verifications,
            lookups,
            issued,
            hashCount: () => hashCount
        };
    }

    it('compares against a dummy hash when no such account exists [activity:I-35]', async () => {
        // No account is the case that would otherwise return instantly. One
        // comparison runs anyway, against the throwaway hash, so "unknown
        // email" and "wrong password" cost the same ~250ms.
        const { useCase, verifications, issued } = harness({ user: null });

        await expect(useCase.execute(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(verifications).toEqual([
            { hashed: DUMMY_HASH, plain: PASSWORD }
        ]);
        expect(issued).toEqual([]);
    });

    it('records a refused attempt keyed on the address, not on a user', async () => {
        // The failures worth reading are exactly the ones with no account
        // behind them, so the subject has to be the address. `userId` rides in
        // the payload only when the address actually resolved.
        const { useCase, events } = harness({ user: null });

        await expect(
            useCase.execute('  ADA@Example.com ', PASSWORD)
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('auth.sign_in_failed');
        expect(events[0].aggregateType).toBe('login_attempt');
        // Trimmed and lowercased, so one address is one subject.
        expect(events[0].aggregateId).toBe('ada@example.com');
        expect(events[0].payload.reason).toBe('unknown_account');
        expect(events[0].payload.userId).toBeNull();
        // No actor: a failed sign-in has established who nobody is, and naming
        // the attempted account would attribute an action to a person who may
        // have had nothing to do with it.
        expect(events[0].payload.actor).toBeUndefined();
    });

    it('records a wrong password against a real account as its own reason', async () => {
        // The distinction that makes the event worth writing: address guessing
        // and a person mistyping their password are the same flat 401 to the
        // caller and completely different facts to an operator.
        const { useCase, events } = harness({
            user: credentials(),
            passwordOk: false
        });

        await expect(useCase.execute(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(events).toHaveLength(1);
        expect(events[0].payload.reason).toBe('bad_password');
        expect(events[0].payload.userId).toBe(USER_ID);
    });

    it('carries the attempt’s IP and User-Agent, the only handles it has', async () => {
        const { useCase, events } = harness({ user: null });

        await expect(
            useCase.execute(EMAIL, PASSWORD, {
                ipAddress: '203.0.113.7',
                userAgent: 'curl/8.5.0'
            })
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(events[0].payload.ipAddress).toBe('203.0.113.7');
        expect(events[0].payload.userAgent).toBe('curl/8.5.0');
    });

    it('refuses a pending invite the same way, opening no session [activity:I-35]', async () => {
        // `pending` means the invite was never accepted, so there is no hash to
        // compare — the dummy stands in for it.
        const { useCase, verifications, issued, events } = harness({
            user: credentials({ status: 'pending', passwordHash: null })
        });

        await expect(useCase.execute(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(verifications).toEqual([
            { hashed: DUMMY_HASH, plain: PASSWORD }
        ]);
        expect(issued).toEqual([]);
        // No session — and one `auth.sign_in_failed`, which is the whole
        // difference from before: a refusal used to leave no trace at all, so a
        // log full of successful sign-ins was equally consistent with nobody
        // guessing and with a sustained attack.
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('auth.sign_in_failed');
        expect(events[0].payload.reason).toBe('not_active');
    });

    it('refuses a disabled account holding the right password, opening no session [identity:I-02]', async () => {
        // identity:I-02: only an `active` account gets a session. The password verifies,
        // and it still ends in the same generic error.
        const { useCase, verifications, issued, events } = harness({
            user: credentials({ status: 'disabled' }),
            passwordOk: true
        });

        await expect(useCase.execute(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(verifications).toEqual([{ hashed: HASH, plain: PASSWORD }]);
        expect(issued).toEqual([]);
        // A `disabled` account and a `pending` one share one reason bucket:
        // both mean "this address is not a way in right now", and splitting
        // them would report an account's lifecycle to whoever reads the log
        // without telling an operator anything the member page does not.
        expect(events).toHaveLength(1);
        expect(events[0].payload.reason).toBe('not_active');
    });

    it('still spends a comparison when passwords are switched off for the address', async () => {
        // Without it this refusal would return instantly while the root
        // administrator's took ~250ms, and a handful of timed guesses would
        // find the break-glass address.
        const { useCase, verifications, calls } = harness({
            config: {
                sso: { allowPasswordLogin: false },
                rootAdmin: { email: 'root@example.com' }
            }
        });

        await expect(useCase.execute(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(verifications).toEqual([
            { hashed: DUMMY_HASH, plain: PASSWORD }
        ]);
        // The refusal is decided before the account is ever looked up.
        expect(calls).not.toContain('users.credentialsByEmail');
    });

    it('exempts the root administrator by normalized address', async () => {
        // The break-glass exemption is one address, compared trimmed and
        // case-folded on both sides — an operator typing their own address with
        // different capitalization must not be locked out of their own CMS.
        const { useCase, lookups, issued } = harness({
            config: {
                sso: { allowPasswordLogin: false },
                rootAdmin: { email: '  Root@Example.COM  ' }
            },
            user: credentials({ email: 'root@example.com' })
        });

        await expect(
            useCase.execute(' ROOT@example.com ', PASSWORD)
        ).resolves.toMatchObject({ token: expect.any(String) });

        expect(lookups).toEqual([' ROOT@example.com ']);
        expect(issued).toEqual([USER_ID]);
    });

    it('opens the session and records auth.signed_in in one unit of work', async () => {
        const { useCase, calls, events } = harness();

        await useCase.execute(EMAIL, PASSWORD);

        expect(calls).toEqual([
            'users.credentialsByEmail',
            'hashing.verifyPassword',
            'uow.run:enter',
            'sessions.issue',
            'outbox.append',
            'uow.run:exit'
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'auth.signed_in',
            aggregateType: 'user',
            aggregateId: USER_ID,
            payload: { actor: { id: USER_ID, email: EMAIL } }
        });
    });

    it('computes the throwaway hash once per instance, not once per attempt', async () => {
        // The equalizer is a fixed cost paid at first use; recomputing it would
        // make the failing path *slower* than the succeeding one and reopen the
        // oracle from the other side.
        const h = harness({ user: null });

        await expect(attempt(h)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );
        await expect(attempt(h)).rejects.toBeInstanceOf(
            InvalidCredentialsError
        );

        expect(h.hashCount()).toBe(1);
    });

    /** One sign-in attempt against a harness, for the memoization test. */
    function attempt(h: Harness): Promise<unknown> {
        return h.useCase.execute(EMAIL, PASSWORD);
    }
});
