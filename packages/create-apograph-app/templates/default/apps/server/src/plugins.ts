import type { ServerPlugin } from '@apograph/bootstrap-server';
import { ActivityPlugin } from '@apograph/activity-server';
import { ContentPlugin, ContentViewsPlugin } from '@apograph/content-server';
import { DatabasePlugin } from '@apograph/database';
import { I18nServerPlugin } from '@apograph/i18n-server';
import { IdentityPlugin } from '@apograph/identity-server';
// apograph:if sso
import type { SsoRegistration } from '@apograph/identity-domain';
// apograph:end
// apograph:if sso-oidc
import { createOidcProvider } from '@apograph/identity-provider-oidc';
// apograph:end
// apograph:if sso-github
import { createGithubProvider } from '@apograph/identity-provider-github';
// apograph:end
// apograph:if sso-saml
import { createSamlProvider } from '@apograph/identity-provider-saml';
// apograph:end
// apograph:if mail
import { MailServerPlugin } from '@apograph/mail-server';
// apograph:end
// apograph:if mail-smtp
import { createSmtpMailProvider } from '@apograph/mail-provider-smtp';
// apograph:end
import { MediaServerPlugin } from '@apograph/media-server';
// apograph:if media-local
import { createLocalStorageProvider } from '@apograph/media-provider-local';
// apograph:end
// apograph:if media-s3
import { createS3StorageProvider } from '@apograph/media-provider-s3';
// apograph:end
// apograph:if media-azure
import { createAzureStorageProvider } from '@apograph/media-provider-azure';
// apograph:end
// apograph:if media-gcs
import { createGcsStorageProvider } from '@apograph/media-provider-gcs';
// apograph:end
// apograph:if media-vercel-blob
import { createVercelBlobStorageProvider } from '@apograph/media-provider-vercel-blob';
// apograph:end
import { UsersPlugin } from '@apograph/users-server';
import { AlarmsPlugin } from '@apograph/alarms-server';
import { SegmentsPlugin } from '@apograph/segments-server';
import { ProtectionPlugin } from '@apograph/protection-server';
import { TransferPlugin } from '@apograph/transfer-server';
import { WebhooksPlugin } from '@apograph/webhooks-server';
// apograph:if graphql
import { ContentGraphqlPlugin } from '@apograph/content-graphql';
// apograph:end
// apograph:if mcp
import { McpPlugin } from '@apograph/mcp-server';
// apograph:end
import {
    CopilotPlugin,
    type ProviderRegistration
} from '@apograph/copilot-server';
// apograph:if copilot-anthropic
import { createAnthropicProvider } from '@apograph/copilot-provider-anthropic';
// apograph:end
// apograph:if copilot-openai
import { createOpenAiProvider } from '@apograph/copilot-provider-openai';
// apograph:end
import { WorkspacesPlugin } from '@apograph/workspaces-server';
import type { ApographConfig } from '../apograph.config';

/**
 * The model backends this deployment can actually reach, in preference order.
 *
 * **Only what is configured is registered.** `apograph.config.ts` omits a provider
 * whose connection settings are absent, and an unconfigured backend is skipped
 * here too: the first entry serves a run that names no provider, so a keyless
 * one at the top of the list would be the house default and would fail on the
 * first message.
 *
 * **An app that configured no backend registers none**, and has no copilot.
 * There is no scripted offline adapter to fall back on, so `COPILOT_ENABLED`
 * must stay `false` until a backend is configured — enabling it with an empty
 * list fails at boot rather than shipping a chat that cannot answer.
 */
// apograph:if sso
/**
 * The identity providers this app can actually reach.
 *
 * **Only what is configured is registered.** `apograph.config.ts` omits a provider
 * whose connection settings are missing, and an unconfigured one is skipped
 * here too — it would appear on the sign-in page as a button that can only
 * fail.
 *
 * Running two directories at once is another entry. The name is what
 * `/api/auth/sso/<name>/start` and every `sso_identities` row refer to the
 * provider by, so renaming a registration orphans its links. Register the
 * callback URL `<publicBaseUrl>/api/auth/sso/<name>/callback` with the
 * provider; `ssoCallbackUrl` from `@apograph/identity-server` builds the exact
 * string, which matters because most providers match it byte for byte.
 */
export function ssoProviders(config: ApographConfig): SsoRegistration[] {
    const configured = config.plugins.identity.ssoProviders;
    const providers: SsoRegistration[] = [];
    // apograph:if sso-oidc
    if (configured?.oidc) {
        const { name, ...settings } = configured.oidc;
        providers.push({ name, provider: createOidcProvider(settings) });
    }
    // apograph:end
    // apograph:if sso-github
    if (configured?.github) {
        const { name, ...settings } = configured.github;
        providers.push({ name, provider: createGithubProvider(settings) });
    }
    // apograph:end
    // apograph:if sso-saml
    if (configured?.saml) {
        const { name, ...settings } = configured.saml;
        providers.push({ name, provider: createSamlProvider(settings) });
    }
    // apograph:end

    return providers;
}
// apograph:end

export function copilotProviders(config: ApographConfig): ProviderRegistration[] {
    const providers: ProviderRegistration[] = [];
    // apograph:if copilot-anthropic
    if (config.plugins.copilot.providers.claude) {
        providers.push({
            name: 'claude',
            provider: createAnthropicProvider(
                config.plugins.copilot.providers.claude
            )
        });
    }
    // apograph:end
    // apograph:if copilot-openai
    if (config.plugins.copilot.providers.openai) {
        providers.push({
            name: 'openai',
            provider: createOpenAiProvider(
                config.plugins.copilot.providers.openai
            )
        });
    }
    // apograph:end

    return providers;
}

// apograph:if mail
/**
 * The mail plugin, or nothing — spelled as a list so the composition below
 * stays a flat array rather than growing a conditional inside the one literal
 * meant to read as "what this app runs".
 *
 * **Only a configured backend is registered.** `apograph.config.ts` returns no
 * mail config at all unless `MAIL_PROVIDER` names one, and this returns nothing
 * in that case — so the app boots with no queue and no worker, and the invite
 * and reset routes keep handing the link back for you to pass on. There is no
 * fallback adapter here on purpose: one that wrote messages to the log would
 * make every invitation *look* sent and reach nobody.
 */
function mailPlugin(config: ApographConfig): ServerPlugin[] {
    const mail = config.plugins.mail;
    if (!mail) return [];

    return [
        MailServerPlugin({
            // This line is the single place that selects the backend, the way
            // media's `provider:` selects storage. Swapping relay technology is
            // swapping this expression and the type on `AppMailConfig`.
            // apograph:if mail-smtp
            provider: createSmtpMailProvider(mail.smtp),
            // apograph:end
            config: mail
        })
    ];
}
// apograph:end

/**
 * This app's composition — the whole of what its API is.
 *
 * **The order is migration order.** Migrations are applied by walking this
 * array, with no transaction spanning plugins, so a plugin whose tables
 * reference another's must come after it. `WorkspacesPlugin` follows
 * `IdentityPlugin` because its `memberships` table FK-references identity's
 * `users`: put it first and a *fresh* `apograph migrate` fails with
 * `relation "users" does not exist`, while an already-migrated database
 * migrates perfectly happily — so the mistake ships and bites the next clean
 * install. Add new plugins at the end unless you have a reason not to.
 *
 * Order does **not** decide dependency injection: every plugin module is
 * global and every `onPluginInit` runs before the Nest app is created, so no
 * provider can be constructed before the database connection is open.
 *
 * To add a plugin, install it and add a line. To remove one, delete its line —
 * plugins that extend each other do so through optional ports, so removing one
 * degrades the feature rather than failing boot.
 */
export function buildPlugins(config: ApographConfig): ServerPlugin[] {
    // No content types yet — see the note below. Held in a variable because
    // the GraphQL adapter takes the plugin itself, not just its types.
    const content = ContentPlugin({ types: [] });

    return [
        // First: the only plugin that opens a resource in `onPluginInit`.
        DatabasePlugin({
            connectionString: config.database.url,
            outboxRetentionDays: config.database.outboxRetentionDays
        }),
        // apograph:if sso
        // Identity, plus the identity providers this app offers. The second
        // argument is where constructed adapters go: `apograph.config.ts` holds
        // the typed view of the environment, and an adapter instance is not an
        // environment value.
        IdentityPlugin(config.plugins.identity, {
            sso: { providers: ssoProviders(config) }
        }),
        // apograph:end
        // apograph:ifnot sso
        IdentityPlugin(config.plugins.identity),
        // apograph:end
        WorkspacesPlugin(),
        ActivityPlugin(),
        // apograph:if mail
        // Mail, before users: the dispatcher it binds is what the invite,
        // resend and reset use cases queue their messages through, and what
        // makes those routes stop returning a raw token. Registered only when
        // `MAIL_PROVIDER` names a backend — with none, users injects nothing,
        // sends nothing, and returns the link exactly as it always has.
        //
        // Module order is not what binds it (every plugin module is global),
        // but migration order is, and this list is that order: the plugin owns
        // `mail_deliveries` and ships its own migrations.
        ...mailPlugin(config),
        // apograph:end
        UsersPlugin(),
        // No content types yet. Define some in `apps/server/src/content/`, pass
        // them here as `types`, then add a `drizzle.config.ts` pointing at them and
        // a `migrations` descriptor so `apograph generate` / `apograph migrate` can
        // manage their tables:
        //
        //   ContentPlugin({
        //       types: contentTypes,
        //       migrations: {
        //           dir: () => join(process.cwd(), 'migrations'),
        //           table: '__drizzle_migrations_content'
        //       }
        //   })
        //
        // Until then the plugin serves its generic routes with an empty
        // registry, and owns no tables of its own.
        content,
        // Saved list views — the named filter/sort/column slices an editor
        // returns to. A second plugin entry from the content package because
        // `ServerPlugin.migrations` holds one descriptor per entry; this one
        // ships the feature's own tables. Must follow identity and workspaces:
        // its foreign keys point at their tables and migrations run in order.
        ContentViewsPlugin({ content }),
        // apograph:if graphql
        // The same public content API over GraphQL, on /api/v1/graphql. It owns
        // no schema and adds no credential — it reuses content's bearer guards
        // and read services, so a token minted before it existed works against
        // it unchanged. Taking `content` by value lets it fail boot on two
        // content types that would collide as GraphQL names, rather than on the
        // first request from a workspace granted both.
        ContentGraphqlPlugin({
            content,
            ...config.plugins.contentGraphql,
            // GraphiQL rides the same switch as the Scalar reference: both are
            // developer tooling, and neither should be reachable in production
            // unless the operator asks (`API_DOCS=true`).
            playground: config.docs.enabled === true
        }),
        // apograph:end
        // Fills the Content Library's locale extensions, so it reads after it.
        I18nServerPlugin(config.plugins.i18n),
        // This line is the single place that selects storage — one constructed
        // provider, writing every upload to local disk. A deployment runs
        // exactly one; swapping backend is swapping this expression (and the
        // type of `media.storage` with it).
        // Content alarms — rules that flag content problems without ever
        // blocking a save or a publish. After content, whose registry and
        // filter surface it evaluates rules through.
        AlarmsPlugin(),
        // Outgoing webhooks. Inert until someone adds an endpoint in the admin,
        // and it only subscribes to the outbox, so nothing depends on it being
        // registered any earlier than this. The settings worth knowing about
        // are the two `WEBHOOKS_ALLOW_*` flags — see `config/webhooks.ts`.
        WebhooksPlugin(config.plugins.webhooks),
        MediaServerPlugin({
            // apograph:if media-local
            provider: createLocalStorageProvider(config.plugins.media.storage),
            // apograph:end
            // apograph:if media-s3
            provider: createS3StorageProvider(config.plugins.media.storage),
            // apograph:end
            // apograph:if media-azure
            provider: createAzureStorageProvider(config.plugins.media.storage),
            // apograph:end
            // apograph:if media-gcs
            provider: createGcsStorageProvider(config.plugins.media.storage),
            // apograph:end
            // apograph:if media-vercel-blob
            provider: createVercelBlobStorageProvider(
                config.plugins.media.storage
            ),
            // apograph:end
            config: config.plugins.media
        }),
        // Content export and import, one hop deep: relations, files and
        // locales travel with a record, relations-of-relations stay as
        // references. After content (every write goes through its writer, so
        // an import cannot outrun validation or your own permissions) and
        // after media (files travel with the records that use them). Owns no
        // tables.
        //
        // The setting worth filling in per install is `identity`: it says
        // which field identifies a record of each type, which is what lets an
        // import recognise "this is that record" instead of adding a
        // duplicate. Without it the natural key is a heuristic. It is a map of
        // your own content types rather than an environment value, so it lives
        // in `config/transfer.ts`.
        TransferPlugin(config.plugins.transfer),
        // Reader entitlements — who may *read* published content, as against
        // who may touch it. After content, whose read-scope port it binds, so
        // one decision covers REST, GraphQL and MCP at once.
        //
        // Registering it changes nothing on its own: with no audience created
        // in the admin no predicate is emitted and every read costs what it
        // did before. The line to fill in per install is `resolver` — it says
        // where a reader's tags come from, and its absence means every reader
        // is anonymous, which serves unrestricted content and nothing else. It
        // is a function you write, not an environment value, so it lives in
        // `config/segments.ts`.
        SegmentsPlugin(config.plugins.segments),
        // Publication protection: a per-content-type rule requiring N
        // approvals before an entry may be published. Registered after
        // content, whose `CONTENT_PUBLISH_GUARD` port it fills — with no
        // rule in any workspace the port resolves to always-allowed and
        // publication behaves byte for byte as it does with the plugin
        // uninstalled. It takes no configuration: the rule table is the
        // whole configuration surface, and its empty state is the off
        // state.
        ProtectionPlugin(),
        // Registered after workspaces (runs are workspace-scoped) and identity
        // (runs execute as the calling user, gated on `copilot:use`). The
        // composition root is the single place that selects a backend: the
        // plugin never learns which adapters exist, it takes a list of named,
        // already-constructed providers, and **the order is the setting** —
        // there is no `defaultProvider`, the first entry serves a run that
        // names none.
        CopilotPlugin({
            providers: copilotProviders(config),
            config: config.plugins.copilot
        }),
        // apograph:if mcp
        // The Model Context Protocol front door, registered LAST because it
        // serves whatever the plugins above contributed. Off unless
        // MCP_ENABLED=true: it hands an external agent the same content CRUD a
        // full-scope token has.
        McpPlugin({ config: config.plugins.mcp })
        // apograph:end
    ];
}
