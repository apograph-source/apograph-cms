import { join } from 'node:path';
import type { ServerPlugin } from '@apograph/bootstrap-server';
import { ActivityPlugin } from '@apograph/activity-server';
import { ContentPlugin, ContentViewsPlugin } from '@apograph/content-server';
import { ContentGraphqlPlugin } from '@apograph/content-graphql';
import { CopilotPlugin } from '@apograph/copilot-server';
import { DatabasePlugin } from '@apograph/database';
import { I18nServerPlugin } from '@apograph/i18n-server';
import { TransferPlugin } from '@apograph/transfer-server';
import { AlarmsPlugin } from '@apograph/alarms-server';
import { IdentityPlugin } from '@apograph/identity-server';
import { MailServerPlugin } from '@apograph/mail-server';
import { McpPlugin } from '@apograph/mcp-server';
import { SegmentsPlugin } from '@apograph/segments-server';
import { ProtectionPlugin } from '@apograph/protection-server';
import { createLocalStorageProvider } from '@apograph/media-provider-local';
import { MediaServerPlugin } from '@apograph/media-server';
import { UsersPlugin } from '@apograph/users-server';
import { WebhooksPlugin } from '@apograph/webhooks-server';
import { WorkspacesPlugin } from '@apograph/workspaces-server';
import type { ApographConfig } from '../../../server/apograph.config';
import { testContentTypes } from './content';
import { fakeAltProvider, fakeProvider, testCodeSkills } from './copilot';
import { fakeSsoProvider, ssoRoleResolver } from './sso';
import { headerSegmentResolver } from './segments';
import { testMailProvider } from './mail';
import {
    createInMemoryStorageProvider,
    createSigningStorageProvider
} from './media-storage';

/** Harness-only wiring choices that are not expressible as config. */
export interface BuildTestPluginsOptions {
    /**
     * Boot on the real filesystem provider rooted here, instead of the
     * in-memory one.
     *
     * A deployment runs exactly one storage provider, so this is a choice about
     * which object to construct — not a name in config that something else
     * selects between.
     */
    localMediaRoot?: string;
    /**
     * Boot on a provider that can mint a signed URL, for the direct-serve
     * suites. Mutually exclusive with `localMediaRoot` in practice — nothing
     * needs both, and the filesystem cannot sign.
     */
    signingProvider?: boolean;
    /**
     * Which identity providers to register. `'fake'` (the default) is the
     * scripted provider every SSO suite drives; `'none'` registers none, which
     * is the shape a default install boots in — and the only way to tell the
     * `strict`-cookie boot refusal (which fires on a *registered* provider)
     * from a refusal on the cookie setting alone.
     */
    ssoProviders?: 'fake' | 'none';
    /**
     * Boot the **contentless** host: database, identity, workspaces, activity
     * and users, and nothing else.
     *
     * It is not a filter over the full list. Every remaining plugin composes
     * over content — views and GraphQL take the `ContentPlugin` instance
     * itself, alarms evaluates through content's match query, segments and i18n
     * register into content's ports — so "the list minus content" is not a host
     * anyone could deploy, and would fail to resolve rather than reproduce
     * anything. What a contentless deployment actually looks like is this: the
     * workspaces plugin standing alone, with `CONTENT_ENTRY_COUNTER` unbound
     * (it is injected `@Optional()` precisely so this boots) and the
     * `content_*` tables still sitting in the database from the migrations that
     * created them.
     */
    omitContent?: boolean;
    /**
     * Register the mail plugin, with the capturing testkit provider.
     *
     * Off by default, because registering it **changes the API**: the invite
     * and reset routes stop returning a raw token (ADR-0018 §4), and most of
     * this app's suites accept an invite with the token that response carried.
     * The mail suite opts in; `global-setup` also builds the list with it on,
     * because migrations have to cover every plugin any suite can boot.
     */
    mail?: 'testkit' | 'none';
}

/**
 * Builds the plugin list the e2e harness boots with — the e2e-owned analogue of
 * the host's `apps/server/src/plugins.ts:buildPlugins`. It mirrors the host's
 * wiring and order exactly EXCEPT for content: `ContentPlugin` is registered
 * with the harness's own {@link testContentTypes} and points its `migrations`
 * descriptor at the e2e-owned migration dir (`apps/server-e2e/migrations/
 * content`, generated from `drizzle.config.ts`). This is what decouples the
 * whole e2e run from `apps/server/src/content` — renaming or dropping an app
 * collection no longer affects these tests.
 *
 * Shared by `global-setup` (which reads each plugin's `migrations` descriptor to
 * migrate the shared testcontainer) and `test-app` (which boots the app), so
 * both see exactly the same plugins in the same order. Order matters as in the
 * host: `DatabasePlugin` first (opens the connection), identity before
 * workspaces (FK + reads), workspaces before content (its `WorkspaceGuard` +
 * ports), and i18n after content (binds content's extension port).
 */
export function buildTestPlugins(
    config: ApographConfig,
    options: BuildTestPluginsOptions = {}
): ServerPlugin[] {
    if (options.omitContent) {
        return [
            DatabasePlugin({ connectionString: config.database.url }),
            IdentityPlugin(config.plugins.identity, {
                sso: {
                    providers:
                        options.ssoProviders === 'none'
                            ? []
                            : [{ name: 'fake', provider: fakeSsoProvider }],
                    resolveRole: ssoRoleResolver
                }
            }),
            WorkspacesPlugin(),
            // Kept because the workspaces routes drain their domain events
            // through it: dropping it would change what a delete *records*,
            // which is not what this shape is for.
            ActivityPlugin(),
            UsersPlugin()
        ];
    }

    const content = ContentPlugin({
        types: testContentTypes,
        // The e2e harness OWNS these generated tables: drizzle.config.ts
        // diffs src/support/content into ./migrations/content. Routing the
        // descriptor through the plugin lets `global-setup`'s standard
        // migrate loop apply them with every other plugin's migrations.
        migrations: {
            dir: () => join(__dirname, '../../migrations/content'),
            table: '__drizzle_migrations_content'
        }
    });
    return [
        DatabasePlugin({ connectionString: config.database.url }),
        // Identity, with the scripted identity provider registered under
        // `fake`. The host registers none by default; the harness registers one
        // so the entire SSO redirect handshake — attempt row, state, PKCE,
        // verification, account resolution, session — runs in CI with no
        // tenant and no network.
        IdentityPlugin(config.plugins.identity, {
            sso: {
                providers:
                    options.ssoProviders === 'none'
                        ? []
                        : [{ name: 'fake', provider: fakeSsoProvider }],
                // Always registered, so the wiring is exercised on every boot.
                // It answers `null` — "leave the role alone", the shipped
                // default — unless a test scripts something with
                // `scriptSsoRole`.
                resolveRole: ssoRoleResolver
            }
        }),
        WorkspacesPlugin(),
        ActivityPlugin(),
        // Mail before users, as in the host: `users` queues its three messages
        // through the port this binds, and this plugin owns `mail_deliveries`
        // (migrations run in this array's order). The provider captures rather
        // than sends, and the sender's timer is off in `test-config` for the
        // same reason the webhooks one is.
        ...(options.mail === 'testkit'
            ? [
                  MailServerPlugin({
                      provider: testMailProvider,
                      config: config.plugins.mail ?? {
                          appUrl: 'https://cms.test',
                          from: 'Apograph <no-reply@cms.test>',
                          deliveryIntervalMs: 0
                      }
                  })
              ]
            : []),
        UsersPlugin(),
        content,
        // Saved list views — its own plugin entry from the content package,
        // carrying the feature's own migrations descriptor (content's single
        // slot is already the harness-owned generated tables above). After
        // identity and workspaces: `saved_views` foreign-keys into both, and
        // `global-setup` migrates in this array's order.
        ContentViewsPlugin({ content }),
        // The GraphQL protocol over the same public content API — registered
        // here so the e2e suite exercises the real composition, including the
        // shared bearer guards it depends on.
        ContentGraphqlPlugin({
            content,
            ...config.plugins.contentGraphql,
            // GraphiQL rides the same switch as the Scalar reference: both are
            // developer tooling, and neither should be reachable in production
            // unless the operator asks (`API_DOCS=true`).
            playground: config.docs.enabled === true
        }),
        // Media ships its own migrations (picked up by the migrate loop) and
        // runs one storage provider, like any deployment: the in-memory one, so
        // uploads never touch disk — or the real filesystem adapter when a
        // suite sets `localMediaRoot`, because the claims about what lands on
        // disk, and about a `storage_key` that tries to walk out of the root,
        // can only be checked against a real directory.
        MediaServerPlugin({
            provider: options.localMediaRoot
                ? createLocalStorageProvider(config.plugins.media.storage)
                : options.signingProvider
                  ? createSigningStorageProvider()
                  : createInMemoryStorageProvider(),
            config: config.plugins.media
        }),
        I18nServerPlugin(config.plugins.i18n),
        // Export/import, after content and media for the same reasons the host
        // registers it there.
        TransferPlugin(config.plugins.transfer),
        // Alarms. The sweep is switched OFF here: it is a per-process
        // interval, and a background rescan firing mid-suite would
        // reconcile findings a test is in the middle of asserting on.
        // The event path and the explicit rescan are what the suites
        // exercise, and neither needs the timer.
        AlarmsPlugin({ sweepIntervalMinutes: 0 }),
        // Copilot before MCP: runs are workspace-scoped and execute as the
        // calling user, so it must register after workspaces and identity. Both
        // providers are scripted fakes — no key, no network, and the whole tool
        // loop still exercised.
        //
        // **Two of them, and the order is the assertion.** There is no
        // `defaultProvider` config: a run naming no provider is served by the
        // first registration, so a harness with one provider could not tell a
        // working rule from a broken one. `fake` is first and is what an
        // unnamed run must land on; `fake-alt` is what naming a provider must
        // reach instead.
        CopilotPlugin({
            providers: [
                { name: 'fake', provider: fakeProvider },
                { name: 'fake-alt', provider: fakeAltProvider }
            ],
            // Code-defined skills, so the half of the feature that never
            // touches the database is exercised by the same boot the host
            // performs — including a code skill's name being unavailable to a
            // CMS one.
            skills: testCodeSkills,
            config: config.plugins.copilot
        }),
        // Reader entitlements. After content, whose read-scope, entry-write and
        // filter-field ports it registers into — all three are runtime
        // registrations, so a boot with segments first would silently register
        // nothing. Its resolver reads a header, which is the production seam
        // (the port hands over the request precisely so a header the CDN sets
        // is reachable) rather than a test hook beside one: with no header
        // every reader is anonymous, which is what a fresh install is.
        SegmentsPlugin({ resolver: headerSegmentResolver }),
        // Publication protection. Takes no configuration, and is inert until a
        // suite writes a rule — which is exactly the state it has to keep for
        // every other suite in this app.
        ProtectionPlugin(),
        // Webhooks. Its sender is switched off in `test-config` for the same
        // reason the alarms sweep is — a background timer must not act while a
        // test is asserting — so the suites claim and send a batch explicitly.
        WebhooksPlugin(config.plugins.webhooks),
        // MCP last, as in the host. Enabled here regardless of the
        // `MCP_ENABLED` default so the endpoint is testable; the disabled path
        // is covered by a per-suite config override.
        McpPlugin({ config: config.plugins.mcp })
    ];
}
