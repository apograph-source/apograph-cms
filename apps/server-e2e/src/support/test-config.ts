import type { TrustProxySetting } from '@apograph/bootstrap-server';
import type { ContentGraphqlLimits } from '@apograph/content-graphql';
import type {
    IdentityRateLimitConfig,
    IdentityRootAdminConfig,
    IdentitySessionConfig,
    IdentitySsoConfig
} from '@apograph/identity-server';
import type { RunLimits } from '@apograph/copilot-domain';
import type { LocaleDef, OrphanedLocalePolicy } from '@apograph/i18n-server';
import type { TransferLimits } from '@apograph/transfer-domain';
import type { WebhooksPluginConfig } from '@apograph/webhooks-server';
import type { MailPluginConfig } from '@apograph/mail-server';
import type { ApographConfig } from '../../../server/apograph.config';

/**
 * The host config the e2e app boots with. Mirrors `apps/server/apograph.config.ts`
 * but with deterministic test values and the testcontainer's connection
 * string — so we exercise the real plugin wiring (`buildPlugins`) without
 * depending on the developer's `.env`.
 *
 * `cookieSecure: false` so the session cookie survives plain-HTTP supertest
 * requests; `allowedOrigins` is the dev admin origin, used by the OriginGuard
 * tests.
 */
export const TEST_ALLOWED_ORIGIN = 'http://localhost:4200';

/**
 * Rate limit relaxed by default so a large login suite doesn't self-throttle.
 * The throttle suite overrides this with a low limit to assert the 429 path.
 */
const RELAXED_RATE_LIMIT: IdentityRateLimitConfig = {
    ttlSeconds: 60,
    limit: 1000
};

/** Per-app config tweaks an individual suite may need. */
export interface TestConfigOverrides {
    /** Replace the login rate limit (e.g. pin it low to test throttling). */
    rateLimit?: IdentityRateLimitConfig;
    /** Per-type identity fields for the transfer plugin (import matching). */
    transferIdentity?: Record<string, readonly string[]>;
    /** Narrow a transfer ceiling, to assert the limit rather than the happy path. */
    transferLimits?: Partial<TransferLimits>;
    /**
     * Express `trust proxy`. Unset by default (matching a directly-exposed
     * server, where `X-Forwarded-For` is ignored); the throttle suite boots a
     * second app with it set to prove the rate limit then buckets per
     * forwarded client IP rather than collapsing to one global bucket.
     */
    trustProxy?: TrustProxySetting;
    /**
     * Shrink the request-body cap, so a suite can prove the `413` boundary
     * without shipping a megabyte of fixture — and, more to the point, prove
     * the cap is read from **this config** at all rather than inherited from
     * `express.json()`'s 100 kB default, which is what it used to be.
     */
    bodyLimit?: string | number;
    /** Replace the allow-listed origins. */
    allowedOrigins?: string[];
    /**
     * Override the webhooks settings.
     *
     * The harness default switches the sender's timer **off** and permits
     * private addresses: a background tick would post mid-assertion, and the
     * test receiver lives on `127.0.0.1`, which the shipped policy refuses.
     * A suite that wants the shipped refusal passes
     * `{ allowPrivateNetworks: false }`.
     */
    webhooks?: Partial<WebhooksPluginConfig>;
    /**
     * Boot **with** a mail provider, and with these settings.
     *
     * Absent — the default — is the unconfigured deployment: no mail plugin is
     * registered, nothing is sent, and the invite and reset routes return the
     * raw token, which is what every other suite in this app depends on. Passing
     * anything here (`{}` included) registers the plugin with the capturing
     * testkit provider, which is what changes those responses.
     *
     * The sender's timer is switched **off** for the same reason webhooks' is:
     * a background tick handing a message over mid-assertion is unreadable
     * afterwards. Suites drive one batch through `MailDeliveryWorker.runOnce()`.
     */
    mail?: Partial<MailPluginConfig>;
    /**
     * Override the session-cookie attributes.
     *
     * The default is the plain-HTTP shape supertest needs (`cookieSecure:
     * false`), and for a long time that was the *only* shape reachable — which
     * left the production configuration, where `Secure` is the whole point,
     * asserted nowhere. A suite can now boot the deployed shape and check the
     * `Set-Cookie` header really carries it.
     */
    session?: Partial<IdentitySessionConfig>;
    /**
     * Override the SSO settings — just-in-time provisioning and whether
     * passwords are still accepted.
     *
     * Both are off by default, which is the shipped shape, so a suite that
     * wants either says so explicitly and every other suite keeps the invite-
     * only behaviour it was written against.
     */
    sso?: Partial<IdentitySsoConfig>;
    /**
     * Which identity providers the app boots with.
     *
     * `'fake'` (the default) registers the scripted provider, which is what
     * every SSO suite drives. `'none'` boots the shape a default install has —
     * the routes mounted, nothing registered — and it is the only way to reach
     * two claims: that `GET /auth/sso` answers `[]` rather than 404 on such a
     * deployment, and that the `strict`-cookie boot refusal fires **because a
     * provider is registered** rather than on the cookie setting alone.
     */
    ssoProviders?: 'fake' | 'none';
    /**
     * Configure the root-admin bootstrap. Omitted by default, so the seeder
     * is a no-op and a freshly booted app has no users (matching production
     * with no `APOGRAPH_ROOT_ADMIN_EMAIL` set).
     */
    rootAdmin?: IdentityRootAdminConfig;
    /**
     * Tighten the GraphQL cost budget, so a suite can prove a limit trips
     * without having to author a genuinely enormous document.
     */
    graphqlLimits?: Partial<ContentGraphqlLimits>;
    /**
     * Turn developer tooling on. Two things ride this one flag, and both have
     * the same security story — off unless a deployment asks: the Scalar API
     * reference (`setupApiDocs`, mounted by `createTestApp` exactly as
     * `createServer` mounts it) and the GraphiQL playground.
     */
    docsEnabled?: boolean;
    /**
     * Turn the MCP endpoint off, to assert that the kill switch really
     * unmounts it. Enabled by default so the suites can drive it.
     */
    mcpEnabled?: boolean;
    /**
     * Shorten the MCP per-call deadline, so a suite can prove a hung tool is
     * abandoned without waiting the production 30 seconds for it.
     */
    mcpCallTimeoutMs?: number;
    /**
     * Lower the MCP result ceiling, so a suite can prove the `result_too_large`
     * refusal without producing four megabytes of content to trip it.
     */
    mcpMaxResultBytes?: number;
    /**
     * Lower the media upload cap, so a suite can prove the 413 without
     * shipping a 50 MB fixture — and, more to the point, prove the cap is read
     * from **this config** at all. It used to be a module-level
     * `process.env['MEDIA_MAX_UPLOAD_BYTES']` read inside the upload
     * controllers, which made `plugins.media.maxUploadBytes` inert: an override
     * here changed nothing.
     */
    maxUploadBytes?: number;
    /**
     * Route uploads through the **real** filesystem provider, rooted here,
     * instead of the in-memory one.
     *
     * The harness stores blobs in a `Map` on purpose — no suite should need a
     * disk to test an HTTP contract. The exception is the handful of claims
     * that are *about* the disk: that a blob lands where its key says, that a
     * delete reclaims the directory as well as the file, and that a
     * `storage_key` read back from the database cannot walk out of the storage
     * root. None of those can be observed through a `Map`.
     */
    localMediaRoot?: string;
    /**
     * Serve downloads as a redirect to a signed URL instead of streaming them.
     *
     * Turning it on also swaps the harness's provider for one that can sign —
     * the plugin refuses to boot `signed-url` against a backend that cannot,
     * which is itself asserted in the media-server unit suite.
     */
    directServe?: 'off' | 'signed-url';
    /** Lifetime of those signed URLs, so a suite can assert it is passed on. */
    directServeTtlSeconds?: number;
    /**
     * Replace the configured content locales. Defaults to the host's
     * en/de/fr. A suite pins a **single** locale to prove the coverage rule
     * that `notLocalized` is then forced to `0` — with nowhere to translate
     * to, every record would otherwise be reported as both fully localized and
     * not localized at all, and no combination of seeded data can produce that
     * situation while three locales are configured.
     */
    locales?: LocaleDef[];
    /**
     * Override the copilot's kill switch and run ceilings.
     *
     * The ceilings are the reason this exists: `RunLimits` bounds a run three
     * ways and the defaults (8 steps, two minutes, 120 k tokens) are all far
     * out of reach of a scripted fake, so a suite that wants to see a ceiling
     * trip has to lower it. `enabled` is here for the other half of the same
     * argument — the disabled path answers with an error frame rather than a
     * 403, and that shape has no other way to be reached.
     */
    copilot?: {
        enabled?: boolean;
        maxOutputTokens?: number;
        limits?: Partial<RunLimits>;
    };
    /**
     * How the plugin reacts at boot to rows in an unconfigured locale.
     * `'warn'` here by default rather than the shipped `'fail'`: a suite that
     * seeds such a row on purpose is testing that the rest of the system
     * excludes it, and the app it seeds into has already booted.
     */
    orphanedLocales?: OrphanedLocalePolicy;
    /**
     * Boot **without** the content plugin — the shape a host has when its
     * content plugin was removed (or was never installed) while the
     * `content_*` tables its migrations created are still in the database.
     *
     * A wiring choice, not a config value, so it is forwarded to
     * `buildTestPlugins` rather than into `ApographConfig`. It is the only way to
     * reach the workspaces plugin's fail-closed branch: `CONTENT_ENTRY_COUNTER`
     * is bound by `ContentPlugin`, and with nothing bound the counter reports
     * `0` for a workspace whose entries may very much exist — so the two
     * destructive routes refuse (503) rather than trusting it.
     */
    omitContent?: boolean;
    /**
     * Override the database plugin's settings.
     *
     * Retention is **off** by default for the whole run, the same choice
     * `AlarmsPlugin({ sweepIntervalMinutes: 0 })` and the webhooks sender make
     * and for the same stated reason: the outbox poll is armed in
     * `onApplicationBootstrap` in every spec file, so a background sweep
     * deleting rows while a test is asserting on them is a flake nobody can
     * read afterwards. The retention suite passes a window explicitly, and
     * drives the sweep through the public `pruneDelivered` rather than waiting
     * out the hourly guard.
     */
    database?: {
        /** Days a delivered outbox row is kept; `0` (the default here) never prunes. */
        outboxRetentionDays?: number;
    };
}

export function buildTestConfig(
    connectionString: string,
    overrides: TestConfigOverrides = {}
): ApographConfig {
    return {
        port: 0,
        globalPrefix: 'api',
        trustProxy: overrides.trustProxy,
        // The shipped default, so the parity suite asserts the real number.
        bodyLimit: overrides.bodyLimit ?? '1mb',
        database: {
            url: connectionString,
            // Off unless a suite asks: see `TestConfigOverrides.database`.
            outboxRetentionDays: overrides.database?.outboxRetentionDays ?? 0
        },
        // Read twice: `createTestApp` passes it to `setupApiDocs` (the Scalar
        // reference), and the GraphQL plugin reads it to decide whether to
        // register the GraphiQL playground. Off by default, as in production.
        docs: { enabled: overrides.docsEnabled ?? false },
        plugins: {
            identity: {
                // No identity provider is configured for the e2e run: the
                // harness registers the scripted one directly in
                // `buildTestPlugins`, which is the whole point — the handshake
                // is exercised with no tenant and no network.
                ssoProviders: {},
                // Deliberately no provisioning and passwords on, matching the
                // default install. A suite that needs either passes `sso`.
                sso: { ...overrides.sso },
                allowedOrigins: overrides.allowedOrigins ?? [
                    TEST_ALLOWED_ORIGIN
                ],
                session: {
                    ttlSeconds: 60 * 60 * 24 * 7,
                    cookieSecure: false,
                    cookieSameSite: 'lax',
                    ...overrides.session
                },
                token: {
                    inviteTtlSeconds: 60 * 60 * 24 * 7,
                    resetTtlSeconds: 60 * 60
                },
                rateLimit: overrides.rateLimit ?? RELAXED_RATE_LIMIT,
                rootAdmin: overrides.rootAdmin
            },
            // The e2e content types (`test_article`, `test_author`,
            // `test_landing`) are i18n, so the i18n plugin must be configured to
            // boot — mirrors the host's en (default) / de / fr locales.
            i18n: {
                locales: overrides.locales ?? [
                    { slug: 'en', name: 'English', isDefault: true },
                    { slug: 'de', name: 'Deutsch' },
                    { slug: 'fr', name: 'Français' }
                ],
                orphanedLocales: overrides.orphanedLocales ?? 'warn'
            },
            transfer: {
                // The e2e content types are keyed the way a real install would
                // key them, so the round-trip suite exercises real matching
                // rather than the derived fallback.
                identity: overrides.transferIdentity ?? {},
                // Small ceilings on purpose: a suite that can only pass with
                // production-sized limits is not testing the limits.
                limits: {
                    maxEntries: 500,
                    maxAssets: 100,
                    ...overrides.transferLimits
                }
            },
            // Webhooks. `deliveryIntervalMs: 0` is the important one: the
            // sender is a per-process interval, and a tick firing mid-suite
            // would post a delivery a test is in the middle of asserting on.
            // The suites drive one batch at a time through `WebhookDeliveryWorker.runOnce()`.
            webhooks: {
                deliveryIntervalMs: 0,
                // The test receiver is on loopback, which the shipped policy
                // refuses — that refusal has its own assertion, with the flag
                // turned back off.
                allowPrivateNetworks: true,
                allowInsecureUrls: true,
                // Off: the suites assert what the log holds, and an hourly
                // prune deleting a row mid-assertion is exactly the kind of
                // flake that is hard to read afterwards.
                retentionDays: 0,
                ...overrides.webhooks
            },
            // Mail. Registered only when a suite asks for it (see
            // `TestConfigOverrides.mail`); the settings are still built here so
            // the shape matches the host's.
            ...(overrides.mail
                ? {
                      mail: {
                          backend: 'console' as const,
                          appUrl: 'https://cms.test',
                          from: 'Apograph <no-reply@cms.test>',
                          // The worker is driven explicitly, never by a timer.
                          deliveryIntervalMs: 0,
                          ...overrides.mail
                      }
                  }
                : {}),
            // The reader resolver is not config — it is an object, registered
            // directly in `buildTestPlugins` like the scripted SSO and copilot
            // providers. Left empty here so the shape matches the host's.
            segments: {},
            // The copilot boots ENABLED in tests. Production defaults it off
            // (ADR-0005 §10) because enabling a hosted provider ships content
            // to a third party — but the e2e run's only provider is the
            // scripted fake, which makes no network call, so there is nothing
            // to opt into and everything to cover.
            copilot: {
                enabled: overrides.copilot?.enabled ?? true,
                maxOutputTokens: overrides.copilot?.maxOutputTokens ?? 1024,
                ...(overrides.copilot?.limits
                    ? { limits: overrides.copilot.limits }
                    : {}),
                // Neither hosted backend is configured, exactly as in a clone
                // with no keys — and `buildTestPlugins` registers only the
                // scripted fake, which is therefore the first (and only)
                // provider, and what a run naming none is served by.
                providers: {}
            },
            // `buildTestPlugins` constructs the in-memory provider, so uploads
            // never touch disk — unless a suite asks for the real filesystem
            // adapter with `localMediaRoot`, in which case it builds that one
            // instead. A deployment (and so a booted test app) runs exactly one
            // provider, so this is a choice made there, not a name here.
            media: {
                storage: {
                    rootDir: overrides.localMediaRoot ?? './.storage/test-media'
                },
                maxUploadBytes: overrides.maxUploadBytes ?? 52_428_800,
                ...(overrides.directServe
                    ? { directServe: overrides.directServe }
                    : {}),
                ...(overrides.directServeTtlSeconds
                    ? {
                          directServeTtlSeconds: overrides.directServeTtlSeconds
                      }
                    : {})
            },
            // The GraphQL endpoint's cost budget. Left at the shipped defaults
            // so the limit suite asserts the real numbers rather than
            // test-only ones — except the schema cache, pinned to 0 so a suite
            // that changes a workspace's content grants sees the new schema on
            // the very next request instead of racing a TTL.
            contentGraphql: {
                ...(overrides.graphqlLimits
                    ? { limits: overrides.graphqlLimits }
                    : {}),
                schemaCacheTtlMs: 0
            },
            // Enabled by default here (the host default is off): the endpoint
            // is what the MCP suites drive. `mcpEnabled: false` is how the
            // kill-switch suite asserts the controller is really unmounted.
            mcp: {
                enabled: overrides.mcpEnabled ?? true,
                name: 'apograph-cms-test',
                version: '0.0.0-test',
                callTimeoutMs: overrides.mcpCallTimeoutMs ?? 30_000,
                maxResultBytes: overrides.mcpMaxResultBytes ?? 4_194_304
            }
        }
    };
}
