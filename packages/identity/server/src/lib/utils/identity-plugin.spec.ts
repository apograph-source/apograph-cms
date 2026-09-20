import type { SsoProvider, SsoRegistration } from '@orthacms/identity-domain';
import { IdentityPlugin, type IdentityPluginOptions } from './identity-plugin';
import type { IdentityPluginConfig } from '../types';

/** A registration whose adapter is never called — only the wiring is under test. */
function registration(name = 'okta'): SsoRegistration {
    return { name, provider: {} as SsoProvider };
}

function config(
    overrides: Partial<IdentityPluginConfig> = {}
): IdentityPluginConfig {
    return {
        allowedOrigins: ['https://admin.example.com'],
        session: {
            ttlSeconds: 604800,
            cookieSecure: false,
            cookieSameSite: 'lax'
        },
        token: { inviteTtlSeconds: 604800, resetTtlSeconds: 3600 },
        ...overrides
    };
}

function build(
    overrides: Partial<IdentityPluginConfig> = {},
    options: IdentityPluginOptions = {}
) {
    return () => IdentityPlugin(config(overrides), options);
}

/**
 * `IdentityPlugin`'s construction-time checks — the assertions that turn two
 * silent, unsearchable misconfigurations into a boot failure naming the
 * setting.
 *
 * Both are worth a suite because neither breaks anything visible. A `strict`
 * session cookie is simply not sent on the identity provider's cross-site
 * redirect back, so *every* SSO sign-in fails with the generic error that is
 * the only thing an anonymous caller may be told — diagnosable by reading
 * `Set-Cookie` headers, not by reading an error. And a provisioning domain list
 * that can never match does not break either: the CMS just declines to create
 * anyone, forever.
 *
 * The checks run against the plugin factory, since `assertOptions` is private
 * to the module and its whole contract is "constructing the plugin throws".
 */
describe('IdentityPlugin construction checks', () => {
    describe('SSO providers versus a strict session cookie', () => {
        it('refuses to build with providers registered and cookieSameSite "strict" [identity:I-26]', () => {
            expect(
                build(
                    {
                        session: {
                            ttlSeconds: 604800,
                            cookieSecure: true,
                            cookieSameSite: 'strict'
                        }
                    },
                    { sso: { providers: [registration()] } }
                )
            ).toThrow(/cookieSameSite/);
        });

        it('allows "strict" when no provider is registered', () => {
            // A password-only deployment is entitled to the stricter cookie —
            // there is no cross-site redirect back for it to break.
            const strict = {
                session: {
                    ttlSeconds: 604800,
                    cookieSecure: true,
                    cookieSameSite: 'strict' as const
                }
            };

            expect(build(strict)).not.toThrow();
            expect(build(strict, { sso: { providers: [] } })).not.toThrow();
        });

        it('allows providers on the default "lax" cookie', () => {
            expect(
                build({}, { sso: { providers: [registration()] } })
            ).not.toThrow();
        });
    });

    describe('just-in-time provisioning settings', () => {
        it('refuses an empty domain allow-list even with no provider registered [identity:I-24]', () => {
            // Checked whenever provisioning is configured, so a deployment that
            // turns it on and adds a provider later hears about it on the
            // commit that wrote it, not on the one that made it reachable.
            expect(
                build({
                    sso: {
                        provisioning: { domains: [], defaultRole: 'viewer' }
                    }
                })
            ).toThrow(/at least one email domain/);
        });

        it('refuses a domain entry that can never match an email’s domain', () => {
            expect(
                build({
                    sso: {
                        provisioning: {
                            domains: ['@acme.com'],
                            defaultRole: 'viewer'
                        }
                    }
                })
            ).toThrow(/bare domain/);
            expect(
                build({
                    sso: {
                        provisioning: {
                            domains: ['acme.com', '  '],
                            defaultRole: 'viewer'
                        }
                    }
                })
            ).toThrow(/must not be blank/);
        });

        it('refuses a blank defaultRole, with no provider registered', () => {
            // Every account holds exactly one role and there is none to guess.
            expect(
                build({
                    sso: {
                        provisioning: {
                            domains: ['acme.com'],
                            defaultRole: '   '
                        }
                    }
                })
            ).toThrow(/defaultRole/);
        });

        it('accepts a usable provisioning configuration', () => {
            expect(
                build({
                    sso: {
                        provisioning: {
                            domains: ['acme.com'],
                            defaultRole: 'viewer'
                        }
                    }
                })
            ).not.toThrow();
        });
    });

    it('returns the identity plugin, carrying its config, once the checks pass', () => {
        const plugin = IdentityPlugin(config());

        expect(plugin.name).toBe('identity');
        expect(plugin.identityConfig).toEqual(config());
    });
});
