import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    SsoVerificationError,
    type SsoLogoutNotice,
    type SsoProvider,
    type SsoRegistry
} from '@orthacms/identity-domain';
import { SsoBackchannelLogoutUseCase } from './sso-backchannel-logout.use-case';
import { SsoLogoutFailedError } from '../../domain/errors';
import type { SessionRepository } from '../../domain/session.repository';
import type { SsoIdentityRepository } from '../../domain/sso-identity.repository';
import type { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';

const PROVIDER = 'okta';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'grace@example.com';
const TOKEN = 'a.logout.token';

/**
 * `SsoBackchannelLogoutUseCase` — the endpoint an identity provider posts to
 * when it has ended somebody's session on its side. Two invariants make it
 * worth its own suite, and neither is visible from the route:
 *
 * - **Verification is the adapter's, and an adapter that cannot verify must not
 *   be trusted to have acted.** This route is unauthenticated and reachable by
 *   anyone, so a notification that is not verified would be an open way to sign
 *   arbitrary people out.
 * - **Reach is decided by the notification's shape.** A `sid` names one
 *   provider session and may only end what that session opened; a bare `sub` is
 *   the offboarding case and ends everything. Confusing the two either leaks a
 *   colleague's other devices out from under them or leaves an offboarded
 *   account signed in.
 *
 * And the quiet one: a `sub` this CMS has never seen is **not** an error, or
 * the endpoint becomes an oracle for which of a directory's members hold
 * accounts here.
 *
 * Driven over test doubles for the ports — every decision under test is
 * DB-free, and the call *sequence* (including the calls that must not happen)
 * is the actual assertion.
 */
describe('SsoBackchannelLogoutUseCase', () => {
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

    interface Options {
        /** What `verifyLogoutToken` resolves to; omit for a bare `sid`. */
        notice?: SsoLogoutNotice;
        /** What `verifyLogoutToken` rejects with, instead of resolving. */
        verificationError?: unknown;
        /** Drop `verifyLogoutToken` from the adapter entirely. */
        withoutVerify?: boolean;
        /** The `sso_identities` link the subject resolves to, if any. */
        link?: { userId: string } | null;
        /** How many rows each revoke reports. */
        revoked?: number;
    }

    interface Harness {
        useCase: SsoBackchannelLogoutUseCase;
        events: DomainEvent[];
        /** Every port call, in order, as `name(arg, …)`. */
        calls: string[];
    }

    function harness(options: Options = {}): Harness {
        const events: DomainEvent[] = [];
        const calls: string[] = [];
        const revoked = options.revoked ?? 0;

        const adapter: Partial<SsoProvider> = {};
        if (!options.withoutVerify) {
            adapter.verifyLogoutToken = async (token: string) => {
                calls.push(`verifyLogoutToken(${token})`);
                if (options.verificationError) {
                    throw options.verificationError;
                }
                return options.notice ?? { sessionId: 'provider-session-1' };
            };
        }

        const registry = {
            get: (name: string) => {
                calls.push(`registry.get(${name})`);
                return adapter as SsoProvider;
            }
        } as unknown as SsoRegistry;

        const sessions = {
            revokeBySsoSession: async (
                provider: string,
                ssoSessionId: string
            ) => {
                calls.push(`revokeBySsoSession(${provider},${ssoSessionId})`);
                return revoked;
            },
            revokeAllForUser: async (userId: string) => {
                calls.push(`revokeAllForUser(${userId})`);
                return revoked;
            }
        } as unknown as SessionRepository;

        const identities = {
            findBySubject: async (provider: string, subject: string) => {
                calls.push(`findBySubject(${provider},${subject})`);
                return options.link === undefined
                    ? { userId: USER_ID }
                    : options.link;
            }
        } as unknown as SsoIdentityRepository;

        const users = {
            emailById: async (userId: string) => {
                calls.push(`emailById(${userId})`);
                return EMAIL;
            }
        } as unknown as UserLookupQuery;

        return {
            useCase: new SsoBackchannelLogoutUseCase(
                fakeUow(),
                fakeOutbox(events),
                registry,
                sessions,
                identities,
                users
            ),
            events,
            calls
        };
    }

    it('refuses a provider whose adapter cannot verify a logout token, without touching a session', async () => {
        // The route turns this into a 404: an adapter that does not implement
        // verification must not be talked into acting on an unverified notice.
        const { useCase, calls, events } = harness({ withoutVerify: true });

        await expect(
            useCase.execute({ provider: PROVIDER, token: TOKEN })
        ).rejects.toBeInstanceOf(SsoLogoutFailedError);
        expect(calls).toEqual([`registry.get(${PROVIDER})`]);
        expect(events).toEqual([]);
    });

    it('refuses a request that carried no logout token', async () => {
        const { useCase, calls } = harness();

        await expect(
            useCase.execute({ provider: PROVIDER, token: null })
        ).rejects.toBeInstanceOf(SsoLogoutFailedError);
        expect(calls).toEqual([`registry.get(${PROVIDER})`]);
    });

    it('collapses the adapter’s verification failure into the one logout error', async () => {
        // `SsoVerificationError.reason` is for the log; the caller only ever
        // learns that the notification was refused.
        const { useCase } = harness({
            verificationError: new SsoVerificationError('signature mismatch')
        });

        const error = await useCase
            .execute({ provider: PROVIDER, token: TOKEN })
            .catch((e) => e);

        expect(error).toBeInstanceOf(SsoLogoutFailedError);
        expect(error).not.toBeInstanceOf(SsoVerificationError);
    });

    it('lets a non-verification failure from the adapter through unchanged', async () => {
        // A bug or an outage in the adapter is not "this notice was refused",
        // and dressing it up as one would hide it.
        const boom = new TypeError('adapter exploded');
        const { useCase } = harness({ verificationError: boom });

        await expect(
            useCase.execute({ provider: PROVIDER, token: TOKEN })
        ).rejects.toBe(boom);
    });

    it('ends only the sessions one provider session opened when a sid is named', async () => {
        // The other laptop stays signed in: `revokeAllForUser` must not appear.
        const { useCase, calls } = harness({
            notice: { sessionId: 'provider-session-9' },
            revoked: 2
        });

        const revoked = await useCase.execute({
            provider: PROVIDER,
            token: TOKEN
        });

        expect(revoked).toBe(2);
        expect(calls).toEqual([
            `registry.get(${PROVIDER})`,
            `verifyLogoutToken(${TOKEN})`,
            `revokeBySsoSession(${PROVIDER},provider-session-9)`
        ]);
        expect(calls).not.toContain(`revokeAllForUser(${USER_ID})`);
    });

    it('prefers the sid even when the notice also names a subject', async () => {
        const { useCase, calls } = harness({
            notice: { sessionId: 'provider-session-9', subject: 'subject-1' }
        });

        await useCase.execute({ provider: PROVIDER, token: TOKEN });

        expect(calls).not.toContain(`findBySubject(${PROVIDER},subject-1)`);
        expect(calls).toContain(
            `revokeBySsoSession(${PROVIDER},provider-session-9)`
        );
    });

    it('ends every session the linked account holds when only a subject is named', async () => {
        const { useCase, calls } = harness({
            notice: { subject: 'subject-1' },
            revoked: 3
        });

        const revoked = await useCase.execute({
            provider: PROVIDER,
            token: TOKEN
        });

        expect(revoked).toBe(3);
        expect(calls).toEqual([
            `registry.get(${PROVIDER})`,
            `verifyLogoutToken(${TOKEN})`,
            `findBySubject(${PROVIDER},subject-1)`,
            `revokeAllForUser(${USER_ID})`,
            `emailById(${USER_ID})`
        ]);
    });

    it('records auth.signed_out with the sso_backchannel method when sessions actually ended', async () => {
        const { useCase, events } = harness({
            notice: { subject: 'subject-1' },
            revoked: 3
        });

        await useCase.execute({ provider: PROVIDER, token: TOKEN });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'auth.signed_out',
            aggregateType: 'user',
            aggregateId: USER_ID,
            payload: {
                method: 'sso_backchannel',
                provider: PROVIDER,
                actor: { id: USER_ID, email: EMAIL }
            }
        });
    });

    it('records nothing when the linked account held no live session', async () => {
        const { useCase, events, calls } = harness({
            notice: { subject: 'subject-1' },
            revoked: 0
        });

        expect(
            await useCase.execute({ provider: PROVIDER, token: TOKEN })
        ).toBe(0);
        expect(events).toEqual([]);
        expect(calls).not.toContain(`emailById(${USER_ID})`);
    });

    it('answers 0 for a subject with no account here, revoking nothing and raising nothing', async () => {
        // Not an error, deliberately: a provider legitimately notifies about
        // people who never signed in here, and any other answer would tell an
        // anonymous caller which of a directory's members hold accounts.
        const { useCase, events, calls } = harness({
            notice: { subject: 'a-stranger' },
            link: null
        });

        const revoked = await useCase.execute({
            provider: PROVIDER,
            token: TOKEN
        });

        expect(revoked).toBe(0);
        expect(events).toEqual([]);
        expect(calls).toEqual([
            `registry.get(${PROVIDER})`,
            `verifyLogoutToken(${TOKEN})`,
            `findBySubject(${PROVIDER},a-stranger)`
        ]);
    });

    it('refuses a notice naming neither a session nor a subject', async () => {
        const { useCase, calls } = harness({ notice: {} });

        await expect(
            useCase.execute({ provider: PROVIDER, token: TOKEN })
        ).rejects.toBeInstanceOf(SsoLogoutFailedError);
        expect(calls).toEqual([
            `registry.get(${PROVIDER})`,
            `verifyLogoutToken(${TOKEN})`
        ]);
    });
});
