import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import type {
    SsoRegistration,
    SsoRoleResolver
} from '@orthacms/identity-domain';
import { assertProvisionableDomains } from '../domain/sso-provisioning-policy';
import type { IdentityPluginConfig } from '../types';
import { IdentityModule } from '../identity.module';
import { describeIdentityApi } from '../docs/describe-identity-api';
import { describePreferencesApi } from '../docs/describe-preferences-api';
import { SESSION_COOKIE } from '../auth/services/cookie.service';

/**
 * Server plugin for identity, carrying its config alongside the standard
 * plugin shape.
 */
export interface IdentityServerPlugin extends ServerPlugin {
    /** Identity configuration. */
    identityConfig: IdentityPluginConfig;
}

/**
 * Wiring that is code rather than configuration — today, the SSO adapters.
 *
 * A **second parameter** rather than a change to the first, because
 * `IdentityPlugin(config)` is called by every host, every generated app and the
 * e2e harness, and none of them should have to change to add a feature they do
 * not use. It mirrors the split `CopilotPlugin` makes: connection settings live
 * in config and are read from the environment; constructed adapters are passed
 * here, at the composition root, because an adapter instance is not an
 * environment value.
 */
export interface IdentityPluginOptions {
    /** Single sign-on wiring. Omit it and no provider is registered. */
    sso?: IdentitySsoOptions;
}

/** The SSO adapters this deployment offers. */
export interface IdentitySsoOptions {
    /**
     * The identity providers, in the order the sign-in page shows them.
     *
     * Unlike the copilot's model providers there is no "first one is the
     * default" rule — a person picks a button, so this order is presentation
     * and nothing else. An empty list (or no `sso` at all) means the routes are
     * still mounted and `GET /api/auth/sso` answers `[]`; nothing can be
     * started, because no name resolves.
     */
    providers: readonly SsoRegistration[];
    /**
     * Optional handler deciding which role a sign-in lands on — plain code,
     * returning a role key, or `null` to leave the role alone.
     *
     * Here rather than in config for the same reason the providers are: "which
     * of our groups means editor?" is a deployment's own question, and no
     * configuration shape has ever answered it for everyone. Without a handler
     * the CMS never infers authority from a claim, which is the default.
     *
     * @example
     * ```typescript
     * resolveRole: ({ profile }) =>
     *     profile.groups?.includes('cms-editors') ? 'contributor' : 'viewer'
     * ```
     */
    resolveRole?: SsoRoleResolver;
}

/**
 * Rejects the one configuration in which SSO is registered and cannot possibly
 * work: a `strict` session cookie.
 *
 * An identity provider returns the person with a top-level cross-site
 * navigation. A `strict` cookie is not sent on one, so the callback finds no
 * attempt and *every* sign-in fails — with a generic error, because that is the
 * only thing an anonymous caller may be told. Nothing in the response
 * distinguishes it from a misconfigured provider, so this would be diagnosed by
 * reading `Set-Cookie` headers rather than by reading an error.
 *
 * Failing at construction costs a correctly-configured deployment nothing, and
 * turns a silent, unsearchable failure into a message naming the setting.
 */
function assertOptions(
    config: IdentityPluginConfig,
    options: IdentityPluginOptions
): void {
    const providers = options.sso?.providers ?? [];

    // Provisioning is checked whenever it is configured, even with no provider
    // registered: a deployment that turns it on and then adds a provider later
    // should hear about an unusable domain list on the commit that wrote it,
    // not on the one that made it reachable.
    if (config.sso?.provisioning) {
        assertProvisionableDomains(config.sso.provisioning.domains);
        if (!config.sso.provisioning.defaultRole.trim()) {
            throw new Error(
                'SSO just-in-time provisioning needs a `defaultRole` — every account holds exactly one role, and there is no sensible one to guess.'
            );
        }
    }

    if (providers.length > 0 && config.session.cookieSameSite === 'strict') {
        throw new Error(
            'IdentityPlugin cannot register SSO providers while `session.cookieSameSite` is "strict": the browser would not send the session cookie on the identity provider\'s redirect back, so every SSO sign-in would fail. Use "lax" (the default), or register no SSO providers.'
        );
    }
}

/**
 * Creates the identity plugin. Register it **after** `DatabasePlugin` in
 * the `plugins` array — identity is DB-backed and injects the client from
 * `@orthacms/database`'s global `DatabaseModule`, which must be wired
 * first.
 *
 * System-role seeding (FR-6) runs from a NestJS `OnApplicationBootstrap`
 * hook in `SystemRolesSeeder`, where the client is injected via DI — not
 * from the pre-app `onPluginInit`. First-admin bootstrap (FR-10) follows
 * the same pattern once #16 lands.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *   ],
 * });
 * ```
 */
export function IdentityPlugin(
    config: IdentityPluginConfig,
    options: IdentityPluginOptions = {}
): IdentityServerPlugin {
    assertOptions(config, options);
    return {
        name: 'identity',
        module: IdentityModule.forRoot(config, options),
        identityConfig: config,
        migrations: {
            // Lazy — only called at migrate time, never at boot. Source
            // layout: src/lib/utils → ../../../migrations = <pkg>/migrations.
            // When this package is BUILT/published, switch to a package-root
            // anchor (dirname(require.resolve('@orthacms/identity-server/package.json'))).
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_identity'
        },
        // Identity owns the app's authentication, so it is also the plugin that
        // tells the OpenAPI document how a caller proves who they are. Both
        // schemes are offered document-wide: `@Public()` routes (login) simply
        // ignore them.
        docs: {
            securitySchemes: {
                session: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: SESSION_COOKIE,
                    description:
                        'Opaque session cookie issued by `POST /api/auth/login`. Sent automatically by the browser; the global `AuthGuard` resolves it to the current user.'
                },
                apiToken: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'orthacms_<random>',
                    description:
                        'External API token minted by `POST /api/api-tokens`, shown once at mint time. Scoped to one or more workspaces; a request picks which one it targets with the `X-Workspace-Id` header (optional when the token covers exactly one). Authenticates the public content API (`/api/v1/...`).'
                }
            },
            defaultSecurity: ['session', 'apiToken'],
            // Every one of identity's handlers returns a TypeScript
            // `interface`, which is erased before `@nestjs/swagger` runs — so
            // the scanner emits a status code and no payload at all. This hook
            // writes the response schemas back on. See
            // `packages/bootstrap/server/AGENTS.md` → "The response-schema gap".
            decorate: (document) => {
                describeIdentityApi(document);
                // `/api/preferences` is identity's too, and its own pass
                // because it is a different kind of route: self-service, gated
                // by nothing but the session, and answering a `Pick<>` over a
                // Drizzle row rather than one of identity's view interfaces.
                describePreferencesApi(document);
            }
        }
    };
}
