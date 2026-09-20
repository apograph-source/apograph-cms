import { createHash } from 'node:crypto';
import {
    UnknownSsoProviderError,
    type SsoAuthorizeRequest,
    type SsoProvider,
    type SsoRegistry
} from '@orthacms/identity-domain';
import { StartSsoUseCase } from './start-sso.use-case';
import type {
    OpenSsoAuthRequestInput,
    SsoAuthRequestRepository,
    StartedSsoAuthRequest
} from '../../domain/sso-auth-request.repository';
import { HashingService } from '../../auth/services/hashing.service';
import type { IdentityPluginConfig } from '../../types';

const PROVIDER = 'acme';
const ORIGIN = 'https://cms.example.test';
const INVITE_TOKEN = 'raw-invite-token-1a2b3c4d5e6f';

/**
 * `StartSsoUseCase` — the half of the handshake that runs before the browser
 * leaves. Three things are worth holding it to, and all three are decidable
 * over test doubles:
 *
 * - an unregistered provider name is refused **before** anything is written,
 *   so a typo or a stale bookmark cannot litter the attempts table;
 * - an invite token reaches the repository only as its SHA-256 (identity:I-09) — the
 *   raw value is what an attacker would need, and it never leaves this method;
 * - the adapter is handed the `state` / `nonce` / `codeVerifier` the *core*
 *   minted on the attempt row, rather than minting its own. CSRF and replay
 *   defence is one rule implemented in one place.
 */
describe('StartSsoUseCase', () => {
    /** A configuration with just the fields the SSO start path reads. */
    function config(
        sso: IdentityPluginConfig['sso'] = {}
    ): IdentityPluginConfig {
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

    /** The row the repository hands back — the core's minted secrets. */
    function startedAttempt(): StartedSsoAuthRequest {
        return {
            token: 'browser-request-token',
            state: 'state-from-the-attempt-row',
            nonce: 'nonce-from-the-attempt-row',
            codeVerifier: 'verifier-from-the-attempt-row',
            expiresAt: new Date('2026-01-01T00:10:00.000Z')
        };
    }

    interface Harness {
        useCase: StartSsoUseCase;
        /** Every port call, in the order it happened. */
        calls: string[];
        opened: OpenSsoAuthRequestInput[];
        authorized: SsoAuthorizeRequest[];
    }

    function harness(
        options: {
            registered?: boolean;
            sso?: IdentityPluginConfig['sso'];
        } = {}
    ): Harness {
        const calls: string[] = [];
        const opened: OpenSsoAuthRequestInput[] = [];
        const authorized: SsoAuthorizeRequest[] = [];

        const adapter = {
            authorize: async (request: SsoAuthorizeRequest) => {
                calls.push('adapter.authorize');
                authorized.push(request);
                return { url: `https://idp.example.test/authorize` };
            }
        } as unknown as SsoProvider;

        const registry = {
            get: (name: string) => {
                calls.push('registry.get');
                if (options.registered === false) {
                    throw new UnknownSsoProviderError(name, ['other']);
                }
                return adapter;
            }
        } as unknown as SsoRegistry;

        const requests = {
            open: async (input: OpenSsoAuthRequestInput) => {
                calls.push('requests.open');
                opened.push(input);
                return startedAttempt();
            }
        } as unknown as SsoAuthRequestRepository;

        return {
            useCase: new StartSsoUseCase(
                registry,
                requests,
                new HashingService(),
                config(options.sso)
            ),
            calls,
            opened,
            authorized
        };
    }

    it('refuses an unregistered provider before it writes an attempt', async () => {
        const { useCase, calls } = harness({ registered: false });

        await expect(
            useCase.execute('nope', '/content')
        ).rejects.toBeInstanceOf(UnknownSsoProviderError);
        expect(calls).toEqual(['registry.get']);
    });

    it('carries an invite only as its hash, never the raw token [identity:I-09]', async () => {
        const { useCase, opened } = harness();

        await useCase.execute(PROVIDER, '/content', INVITE_TOKEN);

        const expected = createHash('sha256')
            .update(INVITE_TOKEN)
            .digest('hex');
        expect(opened).toHaveLength(1);
        expect(opened[0].inviteTokenHash).toBe(expected);
        // The whole input, not just that field: a raw token that leaked into
        // `redirectTo` would be just as bad as one stored in its own column.
        expect(JSON.stringify(opened[0])).not.toContain(INVITE_TOKEN);
    });

    it('opens an ordinary attempt with a null invite hash', async () => {
        const { useCase, opened } = harness();

        await useCase.execute(PROVIDER, '/content');

        expect(opened[0]).toEqual({
            provider: PROVIDER,
            redirectTo: '/content',
            ttlSeconds: 600,
            inviteTokenHash: null
        });
    });

    it('honours the configured attempt lifetime', async () => {
        const { useCase, opened } = harness({
            sso: { requestTtlSeconds: 120 }
        });

        await useCase.execute(PROVIDER, '/content');

        expect(opened[0].ttlSeconds).toBe(120);
    });

    it('authorizes only after the attempt exists, with the attempt’s own secrets', async () => {
        // The adapter mints none of these. If it did, the core would have
        // nothing to compare the provider's echo against on the way back.
        const { useCase, calls, authorized } = harness();

        await useCase.execute(PROVIDER, '/content');

        expect(calls).toEqual([
            'registry.get',
            'requests.open',
            'adapter.authorize'
        ]);
        const attempt = startedAttempt();
        expect(authorized).toEqual([
            {
                redirectUri: `${ORIGIN}/api/auth/sso/${PROVIDER}/callback`,
                state: attempt.state,
                nonce: attempt.nonce,
                codeVerifier: attempt.codeVerifier
            }
        ]);
    });

    it('hands the caller the URL, the cookie value and its expiry', async () => {
        const { useCase } = harness();

        const started = await useCase.execute(PROVIDER, '/content');

        const attempt = startedAttempt();
        expect(started).toEqual({
            url: 'https://idp.example.test/authorize',
            requestToken: attempt.token,
            expiresAt: attempt.expiresAt
        });
    });
});
