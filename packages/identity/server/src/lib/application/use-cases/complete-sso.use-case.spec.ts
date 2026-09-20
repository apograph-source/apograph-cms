import { Logger } from '@nestjs/common';
import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    SsoVerificationError,
    type SsoCallback,
    type SsoProfile,
    type SsoProvider,
    type SsoRegistry,
    type SsoRoleContext,
    type SsoRoleResolver
} from '@orthacms/identity-domain';
import {
    CompleteSsoUseCase,
    type CompleteSsoInput
} from './complete-sso.use-case';
import { IDENTITY_EVENT_KINDS } from '../../domain/events/identity-events';
import { SsoLoginFailedError } from '../../domain/errors';
import { UserAccount } from '../../domain/user-account';
import type { UserAccountRepository } from '../../domain/user-account.repository';
import type {
    PendingInvite,
    InviteRepository
} from '../../domain/invite.repository';
import type {
    CreatedSession,
    IssueSessionOptions,
    SessionRepository
} from '../../domain/session.repository';
import type { SessionContext } from '../../domain/session';
import type {
    PendingSsoAuthRequest,
    SsoAuthRequestRepository
} from '../../domain/sso-auth-request.repository';
import type {
    LinkSsoIdentityInput,
    SsoIdentityLink,
    SsoIdentityRepository
} from '../../domain/sso-identity.repository';
import type {
    ProvisionAccountInput,
    SsoProvisioningRepository
} from '../../domain/sso-provisioning.repository';
import type {
    AuthCredentials,
    UserLookupQuery
} from '../../infrastructure/queries/user-lookup.query';
import type { IdentityPluginConfig, IdentitySsoConfig } from '../../types';

const PROVIDER = 'acme';
const OTHER_PROVIDER = 'globex';
const ORIGIN = 'https://cms.example.test';
const STATE = 'the-state-we-stored';
const SUBJECT = 'idp-subject-4711';
const EMAIL = 'ada@acme.test';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const NEW_USER_ID = '22222222-2222-4222-8222-222222222222';
const HASH = `$2b$12$${'a'.repeat(53)}`;
const INVITE_HASH = 'c'.repeat(64);
const SESSION_TOKEN = 'session-token';

/**
 * `CompleteSsoUseCase` — the callback half of an SSO sign-in, and the place
 * where the security design lives as an *ordering* rather than as a set of
 * checks. The tests below are therefore mostly about sequence and about what
 * did **not** happen:
 *
 * - nothing is exchanged with the identity provider until the attempt has been
 *   found by the browser's cookie, matched on provider and `state`, and burned
 *   (identity:I-21) — a replayed callback must find nothing left to spend;
 * - every refusal on every one of those paths is the same `SsoLoginFailedError`,
 *   which is what leaves the caller one indistinguishable `?error=sso`
 *   (identity:I-20);
 * - an unverified address never claims an account, and a `pending` or
 *   `disabled` account never receives a session (identity:I-22);
 * - a role-mapping handler can neither demote an administrator nor fail a
 *   sign-in with a typo (identity:I-23);
 * - just-in-time provisioning is off until a deployment says otherwise, and
 *   then only inside its domain list (identity:I-24).
 *
 * Every port is a test double that appends its name to one `calls` array, so
 * the ordering assertions read as the sequence the class documents.
 */
describe('CompleteSsoUseCase', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // --- fixtures -------------------------------------------------------

    function ssoProfile(overrides: Partial<SsoProfile> = {}): SsoProfile {
        return {
            subject: SUBJECT,
            email: EMAIL,
            emailVerified: true,
            name: 'Ada Lovelace',
            ...overrides
        };
    }

    function pendingAttempt(
        overrides: Partial<PendingSsoAuthRequest> = {}
    ): PendingSsoAuthRequest {
        return {
            id: 'attempt-1',
            provider: PROVIDER,
            state: STATE,
            nonce: 'the-nonce-we-stored',
            codeVerifier: 'the-verifier-we-stored',
            redirectTo: '/content',
            inviteTokenHash: null,
            ...overrides
        };
    }

    function activeCredentials(
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

    function account(status: 'pending' | 'active' | 'disabled'): UserAccount {
        return UserAccount.rehydrate({
            id: USER_ID,
            email: EMAIL,
            status,
            passwordHash: status === 'pending' ? null : HASH
        });
    }

    function existingLink(): SsoIdentityLink {
        return {
            id: 'link-1',
            userId: USER_ID,
            provider: PROVIDER,
            subject: SUBJECT
        };
    }

    function pendingInvite(
        overrides: Partial<PendingInvite> = {}
    ): PendingInvite {
        return {
            tokenId: 'invite-token-row',
            userId: USER_ID,
            email: EMAIL,
            name: 'Ada Lovelace',
            ...overrides
        };
    }

    function config(sso: IdentitySsoConfig = {}): IdentityPluginConfig {
        return {
            allowedOrigins: [ORIGIN],
            session: {
                ttlSeconds: 3600,
                cookieSecure: false,
                cookieSameSite: 'lax'
            },
            token: { inviteTtlSeconds: 3600, resetTtlSeconds: 3600 },
            sso
        } as IdentityPluginConfig;
    }

    function input(
        overrides: Partial<CompleteSsoInput> = {}
    ): CompleteSsoInput {
        return {
            provider: PROVIDER,
            requestToken: 'the-request-cookie',
            params: { state: STATE, code: 'the-code' },
            ...overrides
        };
    }

    // --- harness --------------------------------------------------------

    interface Options {
        /** What `findPendingByToken` resolves to. */
        attempt?: PendingSsoAuthRequest | null;
        /** Whether this call is the one that burns the attempt. */
        consumed?: boolean;
        /** The profile the adapter verifies to. */
        profile?: SsoProfile;
        /** Thrown by `adapter.complete` instead of returning a profile. */
        completeError?: unknown;
        /** An existing `(provider, subject)` link, or none. */
        link?: SsoIdentityLink | null;
        /** What `accounts.findById` resolves to. */
        account?: UserAccount | null;
        /** What `users.credentialsByEmail` resolves to. */
        existing?: AuthCredentials | null;
        /** What `invites.findPendingByTokenHash` resolves to. */
        invite?: PendingInvite | null;
        /** Whether this call is the one that burns the invite. */
        inviteConsumed?: boolean;
        /** The roles this deployment has, by key. */
        roles?: Record<string, string>;
        /** The role key the account currently holds. */
        currentRoleKey?: string | null;
        /** Whether `setRole` actually moved the row. */
        roleChanged?: boolean;
        /** The host's role-mapping handler, when it bound one. */
        resolveRole?: SsoRoleResolver | null;
        /** The deployment's SSO settings. */
        sso?: IdentitySsoConfig;
    }

    interface Harness {
        useCase: CompleteSsoUseCase;
        /** Every port call, in the order it happened. */
        calls: string[];
        /** One entry per `outbox.append`, so a split batch is visible. */
        appends: DomainEvent[][];
        /** The flattened event stream. */
        events: DomainEvent[];
        callbacks: SsoCallback[];
        linked: LinkSsoIdentityInput[];
        provisioned: ProvisionAccountInput[];
        setRoleCalls: { userId: string; roleId: string }[];
        roleContexts: SsoRoleContext[];
        issued: {
            userId: string;
            context: SessionContext;
            options?: IssueSessionOptions;
        }[];
        saved: UserAccount[];
        consumedInvites: string[];
        /** Everything the class logged through `Logger#warn`. */
        warnings: string[];
    }

    function harness(options: Options = {}): Harness {
        const calls: string[] = [];
        const appends: DomainEvent[][] = [];
        const events: DomainEvent[] = [];
        const callbacks: SsoCallback[] = [];
        const linked: LinkSsoIdentityInput[] = [];
        const provisioned: ProvisionAccountInput[] = [];
        const setRoleCalls: Harness['setRoleCalls'] = [];
        const roleContexts: SsoRoleContext[] = [];
        const issued: Harness['issued'] = [];
        const saved: UserAccount[] = [];
        const consumedInvites: string[] = [];
        const warnings: string[] = [];

        jest.spyOn(Logger.prototype, 'warn').mockImplementation(
            (message: unknown) => {
                warnings.push(String(message));
            }
        );

        const attempt =
            options.attempt === undefined ? pendingAttempt() : options.attempt;
        const existing =
            options.existing === undefined
                ? activeCredentials()
                : options.existing;
        const roles = options.roles ?? {
            admin: 'role-admin',
            contributor: 'role-contributor',
            viewer: 'role-viewer'
        };

        const uow = {
            run: (fn: () => Promise<unknown>) => {
                calls.push('uow.run');
                return fn();
            }
        } as unknown as UnitOfWork;

        const outbox = {
            append: async (batch: DomainEvent[]) => {
                calls.push('outbox.append');
                appends.push(batch);
                events.push(...batch);
            }
        } as unknown as OutboxWriter;

        const adapter = {
            complete: async (callback: SsoCallback) => {
                calls.push('adapter.complete');
                callbacks.push(callback);
                if (options.completeError) {
                    throw options.completeError;
                }
                return options.profile ?? ssoProfile();
            }
        } as unknown as SsoProvider;

        const registry = {
            get: () => {
                calls.push('registry.get');
                return adapter;
            }
        } as unknown as SsoRegistry;

        const requests = {
            findPendingByToken: async () => {
                calls.push('requests.findPendingByToken');
                return attempt;
            },
            consume: async () => {
                calls.push('requests.consume');
                return options.consumed ?? true;
            }
        } as unknown as SsoAuthRequestRepository;

        const identities = {
            findBySubject: async () => {
                calls.push('identities.findBySubject');
                return options.link ?? null;
            },
            link: async (linkInput: LinkSsoIdentityInput) => {
                calls.push('identities.link');
                linked.push(linkInput);
                return { id: 'link-new', ...linkInput };
            },
            recordLogin: async () => {
                calls.push('identities.recordLogin');
            }
        } as unknown as SsoIdentityRepository;

        const provisioning = {
            findRoleIdByKey: async (key: string) => {
                calls.push('provisioning.findRoleIdByKey');
                return roles[key] ?? null;
            },
            provision: async (provisionInput: ProvisionAccountInput) => {
                calls.push('provisioning.provision');
                provisioned.push(provisionInput);
                return { userId: NEW_USER_ID, email: provisionInput.email };
            },
            setRole: async (userId: string, roleId: string) => {
                calls.push('provisioning.setRole');
                setRoleCalls.push({ userId, roleId });
                return options.roleChanged ?? true;
            },
            roleKeyOf: async () => {
                calls.push('provisioning.roleKeyOf');
                return options.currentRoleKey ?? 'viewer';
            }
        } as unknown as SsoProvisioningRepository;

        const invites = {
            findPendingByTokenHash: async () => {
                calls.push('invites.findPendingByTokenHash');
                return options.invite ?? null;
            },
            consume: async (tokenId: string) => {
                calls.push('invites.consume');
                consumedInvites.push(tokenId);
                return options.inviteConsumed ?? true;
            }
        } as unknown as InviteRepository;

        const resolveRole: SsoRoleResolver | null = options.resolveRole
            ? (context: SsoRoleContext) => {
                  calls.push('resolveRole');
                  roleContexts.push(context);
                  return (options.resolveRole as SsoRoleResolver)(context);
              }
            : null;

        const accounts = {
            findById: async () => {
                calls.push('accounts.findById');
                return options.account ?? null;
            },
            save: async (value: UserAccount) => {
                calls.push('accounts.save');
                saved.push(value);
            }
        } as unknown as UserAccountRepository;

        const sessions = {
            issue: async (
                userId: string,
                context: SessionContext,
                issueOptions?: IssueSessionOptions
            ): Promise<CreatedSession> => {
                calls.push('sessions.issue');
                issued.push({ userId, context, options: issueOptions });
                return {
                    token: SESSION_TOKEN,
                    expiresAt: new Date('2026-01-01T01:00:00.000Z')
                };
            }
        } as unknown as SessionRepository;

        const users = {
            credentialsByEmail: async () => {
                calls.push('users.credentialsByEmail');
                return existing;
            }
        } as unknown as UserLookupQuery;

        return {
            useCase: new CompleteSsoUseCase(
                uow,
                outbox,
                registry,
                requests,
                identities,
                provisioning,
                invites,
                resolveRole,
                accounts,
                sessions,
                users,
                config(options.sso)
            ),
            calls,
            appends,
            events,
            callbacks,
            linked,
            provisioned,
            setRoleCalls,
            roleContexts,
            issued,
            saved,
            consumedInvites,
            warnings
        };
    }

    /** The event kinds a batch carries, in order. */
    function kinds(events: DomainEvent[]): string[] {
        return events.map((event) => event.kind);
    }

    // --- before the token exchange --------------------------------------

    describe('before anything is exchanged with the provider', () => {
        it('refuses a callback that arrives without the request cookie', async () => {
            const { useCase, calls } = harness();

            await expect(
                useCase.execute(input({ requestToken: null }))
            ).rejects.toBeInstanceOf(SsoLoginFailedError);
            // Not even a lookup: no cookie, no attempt, and no set of
            // correct-looking response parameters substitutes for one.
            expect(calls).toEqual(['registry.get']);
        });

        it('refuses a cookie that names no live attempt', async () => {
            const { useCase, calls } = harness({ attempt: null });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('requests.consume');
            expect(calls).not.toContain('adapter.complete');
        });

        it('refuses an attempt that was started against another provider', async () => {
            const { useCase, calls } = harness({
                attempt: pendingAttempt({ provider: OTHER_PROVIDER })
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('requests.consume');
            expect(calls).not.toContain('adapter.complete');
        });

        it('refuses a state the provider did not echo back correctly', async () => {
            // A forged callback costs one indexed lookup, not a round trip to
            // the identity provider.
            const { useCase, calls } = harness();

            await expect(
                useCase.execute(
                    input({ params: { state: 'forged', code: 'x' } })
                )
            ).rejects.toBeInstanceOf(SsoLoginFailedError);
            expect(calls).not.toContain('requests.consume');
            expect(calls).not.toContain('adapter.complete');
        });

        it('burns the attempt before it exchanges anything, and outside the transaction [identity:I-21]', async () => {
            const { useCase, calls } = harness();

            await useCase.execute(input());

            expect(calls.indexOf('requests.consume')).toBeLessThan(
                calls.indexOf('adapter.complete')
            );
            expect(calls.indexOf('adapter.complete')).toBeLessThan(
                calls.indexOf('uow.run')
            );
            expect(calls).toEqual([
                'registry.get',
                'requests.findPendingByToken',
                'requests.consume',
                'adapter.complete',
                'uow.run',
                'identities.findBySubject',
                'users.credentialsByEmail',
                'identities.link',
                'sessions.issue',
                'outbox.append'
            ]);
        });

        it('refuses a replay that lost the race to burn the attempt', async () => {
            const { useCase, calls } = harness({ consumed: false });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('adapter.complete');
        });

        it('hands the adapter the stored secrets and the exact callback URL', async () => {
            const { useCase, callbacks } = harness();

            await useCase.execute(input());

            const attempt = pendingAttempt();
            expect(callbacks).toEqual([
                {
                    params: { state: STATE, code: 'the-code' },
                    state: attempt.state,
                    nonce: attempt.nonce,
                    codeVerifier: attempt.codeVerifier,
                    redirectUri: `${ORIGIN}/api/auth/sso/${PROVIDER}/callback`
                }
            ]);
        });
    });

    // --- what the adapter throws ----------------------------------------

    describe('when the adapter rejects the response', () => {
        it('collapses a verification failure into the one generic error [identity:I-20]', async () => {
            const { useCase, calls } = harness({
                completeError: new SsoVerificationError('the nonce is stale')
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('uow.run');
        });

        it('lets a programming error through rather than dressing it as a refusal', async () => {
            // Masking a `TypeError` here would turn an adapter bug into a
            // sign-in that "just fails", with the stack lost.
            const boom = new TypeError('cannot read properties of undefined');
            const { useCase } = harness({ completeError: boom });

            await expect(useCase.execute(input())).rejects.toBe(boom);
        });

        it('refuses a profile whose subject is merely the email address', async () => {
            const { useCase, calls } = harness({
                profile: ssoProfile({ subject: EMAIL })
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('uow.run');
        });
    });

    // --- an existing link -----------------------------------------------

    describe('when the subject is already linked', () => {
        it('signs the account in and stamps the link', async () => {
            const { useCase, calls, issued } = harness({
                link: existingLink(),
                account: account('active')
            });

            const completed = await useCase.execute(input());

            expect(completed.redirectTo).toBe('/content');
            expect(completed.session.token).toBe(SESSION_TOKEN);
            expect(calls).toContain('identities.recordLogin');
            // An existing link is never re-created, and the email lookup is
            // not consulted: the link is the answer.
            expect(calls).not.toContain('identities.link');
            expect(calls).not.toContain('users.credentialsByEmail');
            expect(issued[0].userId).toBe(USER_ID);
        });

        it('refuses a link that points at a disabled account', async () => {
            const { useCase, calls } = harness({
                link: existingLink(),
                account: account('disabled')
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('sessions.issue');
            expect(calls).not.toContain('outbox.append');
        });

        it('refuses a link that points at an account still awaiting its invite', async () => {
            const { useCase, calls } = harness({
                link: existingLink(),
                account: account('pending')
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('sessions.issue');
        });

        it('refuses a link whose account has since been deleted', async () => {
            const { useCase, calls } = harness({
                link: existingLink(),
                account: null
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('sessions.issue');
        });
    });

    // --- claiming an account that already exists -------------------------

    describe('when a first sign-in claims an existing account', () => {
        it('refuses to link an address the provider will not vouch for [identity:I-22]', async () => {
            const { useCase, calls } = harness({
                profile: ssoProfile({ emailVerified: false })
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            // The gate is checked before the account is even looked up, so
            // nothing is linked and nothing is disclosed.
            expect(calls).not.toContain('identities.link');
            expect(calls).not.toContain('users.credentialsByEmail');
            expect(calls).not.toContain('sessions.issue');
        });

        it('links the verified profile to the account holding that address', async () => {
            const { useCase, linked, events } = harness();

            await useCase.execute(input());

            expect(linked).toEqual([
                {
                    userId: USER_ID,
                    provider: PROVIDER,
                    subject: SUBJECT,
                    email: EMAIL
                }
            ]);
            expect(kinds(events)).toEqual([
                IDENTITY_EVENT_KINDS.SSO_LINKED,
                IDENTITY_EVENT_KINDS.SIGNED_IN
            ]);
        });

        it('refuses an address whose account is disabled', async () => {
            const { useCase, calls } = harness({
                existing: activeCredentials({ status: 'disabled' })
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('identities.link');
            expect(calls).not.toContain('sessions.issue');
        });
    });

    // --- the invite path -------------------------------------------------

    describe('when the attempt carries an invite', () => {
        const attempt = () => pendingAttempt({ inviteTokenHash: INVITE_HASH });

        it('refuses an invite addressed to someone else', async () => {
            // Otherwise anyone holding an invite link could redeem it with an
            // account of their own and keep the role it granted.
            const { useCase, calls } = harness({
                attempt: attempt(),
                invite: pendingInvite({ email: 'grace@acme.test' })
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('invites.consume');
            expect(calls).not.toContain('identities.link');
            expect(calls).not.toContain('sessions.issue');
        });

        it('refuses an invite that lost the race to be redeemed', async () => {
            const { useCase, calls } = harness({
                attempt: attempt(),
                invite: pendingInvite(),
                inviteConsumed: false,
                account: account('pending')
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('accounts.save');
            expect(calls).not.toContain('sessions.issue');
        });

        it('refuses an unknown or already-spent invite link', async () => {
            const { useCase, calls } = harness({
                attempt: attempt(),
                invite: null
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('invites.consume');
        });

        it('refuses an invite redeemed with an unverified address', async () => {
            const { useCase, calls } = harness({
                attempt: attempt(),
                profile: ssoProfile({ emailVerified: false }),
                invite: pendingInvite()
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('invites.findPendingByTokenHash');
        });

        it('activates the account without a credential and links the provider', async () => {
            const pending = account('pending');
            const { useCase, saved, linked, events, consumedInvites } = harness(
                {
                    attempt: attempt(),
                    invite: pendingInvite({ email: '  Ada@Acme.test ' }),
                    account: pending
                }
            );

            const completed = await useCase.execute(input());

            expect(consumedInvites).toEqual(['invite-token-row']);
            expect(saved).toEqual([pending]);
            expect(pending.status.value).toBe('active');
            expect(pending.passwordHash).toBeNull();
            expect(linked).toEqual([
                {
                    userId: USER_ID,
                    provider: PROVIDER,
                    subject: SUBJECT,
                    email: EMAIL
                }
            ]);
            expect(kinds(events)).toEqual([
                IDENTITY_EVENT_KINDS.USER_ACTIVATED,
                IDENTITY_EVENT_KINDS.SSO_LINKED,
                IDENTITY_EVENT_KINDS.SIGNED_IN
            ]);
            expect(completed.session.token).toBe(SESSION_TOKEN);
        });

        it('refuses an invite whose account is no longer awaiting acceptance', async () => {
            const { useCase, calls } = harness({
                attempt: attempt(),
                invite: pendingInvite(),
                account: account('active')
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('accounts.save');
            expect(calls).not.toContain('sessions.issue');
        });
    });

    // --- just-in-time provisioning ---------------------------------------

    describe('just-in-time provisioning', () => {
        it('is off by default: an unknown address simply cannot sign in [identity:I-24]', async () => {
            const { useCase, calls } = harness({ existing: null });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('provisioning.provision');
            expect(calls).not.toContain('sessions.issue');
        });

        it('refuses an address outside the deployment’s domain list [identity:I-24]', async () => {
            const { useCase, calls } = harness({
                existing: null,
                profile: ssoProfile({ email: 'ada@evil-acme.test' }),
                sso: {
                    provisioning: {
                        domains: ['acme.test'],
                        defaultRole: 'viewer'
                    }
                }
            });

            await expect(useCase.execute(input())).rejects.toBeInstanceOf(
                SsoLoginFailedError
            );
            expect(calls).not.toContain('provisioning.provision');
        });

        it('creates a passwordless account on the configured role and links it', async () => {
            const { useCase, provisioned, linked, events, issued } = harness({
                existing: null,
                sso: {
                    provisioning: {
                        domains: ['acme.test'],
                        defaultRole: 'viewer'
                    }
                }
            });

            await useCase.execute(input());

            expect(provisioned).toEqual([
                { email: EMAIL, name: 'Ada Lovelace', roleId: 'role-viewer' }
            ]);
            expect(linked[0]).toMatchObject({ userId: NEW_USER_ID });
            expect(kinds(events)).toEqual([
                IDENTITY_EVENT_KINDS.SSO_PROVISIONED,
                IDENTITY_EVENT_KINDS.SSO_LINKED,
                IDENTITY_EVENT_KINDS.SIGNED_IN
            ]);
            expect(issued[0].userId).toBe(NEW_USER_ID);
        });
    });

    // --- role mapping -----------------------------------------------------

    describe('role mapping', () => {
        it('never demotes an account that already holds admin [identity:I-23]', async () => {
            const { useCase, calls, setRoleCalls, warnings, events } = harness({
                currentRoleKey: 'admin',
                resolveRole: () => 'viewer'
            });

            await useCase.execute(input());

            expect(setRoleCalls).toEqual([]);
            expect(calls).not.toContain('provisioning.setRole');
            expect(
                warnings.some((line) =>
                    line.includes('wanted to move an administrator')
                )
            ).toBe(true);
            // Refusing the mapping does not refuse the sign-in.
            expect(kinds(events)).toContain(IDENTITY_EVENT_KINDS.SIGNED_IN);
        });

        it('ignores a role key this deployment does not have, and says so [identity:I-23]', async () => {
            const { useCase, calls, setRoleCalls, warnings } = harness({
                currentRoleKey: 'viewer',
                resolveRole: () => 'editor-in-chief'
            });

            const completed = await useCase.execute(input());

            expect(setRoleCalls).toEqual([]);
            expect(calls).not.toContain('provisioning.setRole');
            expect(
                warnings.some((line) => line.includes('editor-in-chief'))
            ).toBe(true);
            // A typo in a handler must not lock a directory out of the CMS.
            expect(completed.session.token).toBe(SESSION_TOKEN);
        });

        it('moves the account and records the fact when the key resolves', async () => {
            const { useCase, setRoleCalls, events } = harness({
                currentRoleKey: 'viewer',
                resolveRole: () => 'contributor'
            });

            await useCase.execute(input());

            expect(setRoleCalls).toEqual([
                { userId: USER_ID, roleId: 'role-contributor' }
            ]);
            expect(kinds(events)).toContain(
                IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED
            );
        });

        it('raises no event when the role was already the one asked for', async () => {
            const { useCase, setRoleCalls, events } = harness({
                currentRoleKey: 'contributor',
                resolveRole: () => 'contributor',
                roleChanged: false
            });

            await useCase.execute(input());

            expect(setRoleCalls).toHaveLength(1);
            expect(kinds(events)).not.toContain(
                IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED
            );
        });

        it('leaves the role alone when the handler answers null', async () => {
            const { useCase, calls, events } = harness({
                resolveRole: () => null
            });

            await useCase.execute(input());

            expect(calls).not.toContain('provisioning.roleKeyOf');
            expect(calls).not.toContain('provisioning.setRole');
            expect(kinds(events)).not.toContain(
                IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED
            );
        });

        it('leaves the role alone when no handler is bound at all', async () => {
            const { useCase, calls, events } = harness();

            await useCase.execute(input());

            expect(calls).not.toContain('provisioning.roleKeyOf');
            expect(calls).not.toContain('provisioning.setRole');
            expect(kinds(events)).not.toContain(
                IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED
            );
        });

        it('asks a just-provisioned account’s role only once', async () => {
            // The handler already chose the role while the account was being
            // created; asking again would raise a change event for a role that
            // never moved.
            const { useCase, calls, roleContexts, events } = harness({
                existing: null,
                resolveRole: () => 'contributor',
                sso: {
                    provisioning: {
                        domains: ['acme.test'],
                        defaultRole: 'viewer'
                    }
                }
            });

            await useCase.execute(input());

            expect(roleContexts).toEqual([
                {
                    provider: PROVIDER,
                    profile: expect.objectContaining({ subject: SUBJECT }),
                    isNewAccount: true
                }
            ]);
            expect(calls).not.toContain('provisioning.roleKeyOf');
            expect(calls).not.toContain('provisioning.setRole');
            expect(kinds(events)).not.toContain(
                IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED
            );
        });
    });

    // --- the session and the events --------------------------------------

    describe('the session it opens and the batch it appends', () => {
        it('records the provider and its session id on the session row', async () => {
            const { useCase, issued } = harness({
                profile: ssoProfile({ sessionId: 'idp-session-9' })
            });

            await useCase.execute(
                input({ context: { ipAddress: '203.0.113.7', userAgent: 'a' } })
            );

            expect(issued).toEqual([
                {
                    userId: USER_ID,
                    context: { ipAddress: '203.0.113.7', userAgent: 'a' },
                    options: {
                        ssoProvider: PROVIDER,
                        ssoSessionId: 'idp-session-9'
                    }
                }
            ]);
        });

        it('shortens the session when the deployment asked for a shorter one', async () => {
            const { useCase, issued } = harness({
                sso: { sessionTtlSeconds: 900 }
            });

            await useCase.execute(input());

            expect(issued[0].options).toEqual({
                ssoProvider: PROVIDER,
                ssoSessionId: null,
                ttlSeconds: 900
            });
        });

        it('appends one batch, in order, with one actor on every event', async () => {
            const { useCase, appends } = harness({
                existing: null,
                sso: {
                    provisioning: {
                        domains: ['acme.test'],
                        defaultRole: 'viewer'
                    }
                }
            });

            await useCase.execute(input());

            expect(appends).toHaveLength(1);
            expect(kinds(appends[0])).toEqual([
                IDENTITY_EVENT_KINDS.SSO_PROVISIONED,
                IDENTITY_EVENT_KINDS.SSO_LINKED,
                IDENTITY_EVENT_KINDS.SIGNED_IN
            ]);
            for (const event of appends[0]) {
                expect(event.payload).toMatchObject({
                    actor: { id: NEW_USER_ID, email: EMAIL }
                });
                expect(event.aggregateId).toBe(NEW_USER_ID);
            }
        });
    });
});
