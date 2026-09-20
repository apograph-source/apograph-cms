import { Inject, Injectable } from '@nestjs/common';
import { SSO_REGISTRY, type SsoRegistry } from '@orthacms/identity-domain';
import {
    SSO_AUTH_REQUEST_REPOSITORY,
    type SsoAuthRequestRepository
} from '../../domain/sso-auth-request.repository';
import type { IdentityPluginConfig } from '../../types';
import { InjectIdentityConfig } from '../../identity.tokens';
import { HashingService } from '../../auth/services/hashing.service';
import { ssoCallbackUrl, ssoRequestTtlSeconds } from '../../sso/sso-settings';

/** Everything the controller needs to send the browser onward. */
export interface StartedSsoSignIn {
    /** The provider's authorization URL to redirect to. */
    url: string;
    /** The opaque token to put in the short-lived request cookie. */
    requestToken: string;
    /** When that cookie (and the attempt behind it) stops being valid. */
    expiresAt: Date;
}

/**
 * Opens an SSO sign-in attempt and builds the URL that starts it.
 *
 * **Two deliberate absences.** There is no unit of work: opening an attempt is
 * a single insert, and a transaction around one statement buys nothing. And the
 * adapter's `authorize` is called *after* that insert has committed rather than
 * inside it — an adapter may fetch a discovery document, and holding a write
 * transaction open across a network call to a third party is how one slow
 * identity provider becomes database contention. A failed `authorize` leaves an
 * unused attempt row behind, which costs nothing and expires on its own.
 *
 * @throws UnknownSsoProviderError when nothing is registered under `provider`.
 */
@Injectable()
export class StartSsoUseCase {
    constructor(
        @Inject(SSO_REGISTRY) private readonly registry: SsoRegistry,
        @Inject(SSO_AUTH_REQUEST_REPOSITORY)
        private readonly requests: SsoAuthRequestRepository,
        private readonly hashing: HashingService,
        @InjectIdentityConfig() private readonly config: IdentityPluginConfig
    ) {}

    /**
     * @param provider The registered provider name from the route.
     * @param redirectTo Where to land afterwards. Must already have passed
     *   `safeRedirectPath` — the controller validates it, so nothing below has
     *   to wonder whether this string can leave the origin.
     * @param inviteToken The raw invite token, when the person is accepting an
     *   invitation by signing in with their work account rather than by setting
     *   a password. Hashed here and carried on the attempt row; the raw value
     *   never reaches the repository, like every other token in this plugin.
     */
    async execute(
        provider: string,
        redirectTo: string,
        inviteToken?: string
    ): Promise<StartedSsoSignIn> {
        const adapter = this.registry.get(provider);

        const attempt = await this.requests.open({
            provider,
            redirectTo,
            ttlSeconds: ssoRequestTtlSeconds(this.config),
            inviteTokenHash: inviteToken
                ? this.hashing.hashToken(inviteToken)
                : null
        });

        const { url } = await adapter.authorize({
            redirectUri: ssoCallbackUrl(this.config, provider),
            state: attempt.state,
            nonce: attempt.nonce,
            codeVerifier: attempt.codeVerifier
        });

        return {
            url,
            requestToken: attempt.token,
            expiresAt: attempt.expiresAt
        };
    }
}
