import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { ActivityPlugin } from '@orthacms/activity-server';
import { ContentPlugin, ContentViewsPlugin } from '@orthacms/content-server';
import { DatabasePlugin } from '@orthacms/database';
import { I18nServerPlugin } from '@orthacms/i18n-server';
import { IdentityPlugin } from '@orthacms/identity-server';
// ortha:if sso
import type { SsoRegistration } from '@orthacms/identity-domain';
// ortha:end
// ortha:if sso-oidc
import { createOidcProvider } from '@orthacms/identity-provider-oidc';
// ortha:end
// ortha:if sso-github
import { createGithubProvider } from '@orthacms/identity-provider-github';
// ortha:end
// ortha:if sso-saml
import { createSamlProvider } from '@orthacms/identity-provider-saml';
// ortha:end
// ortha:if mail
import { MailServerPlugin } from '@orthacms/mail-server';
// ortha:end
// ortha:if mail-smtp
import { createSmtpMailProvider } from '@orthacms/mail-provider-smtp';
// ortha:end
import { MediaServerPlugin } from '@orthacms/media-server';
// ortha:if media-local
import { createLocalStorageProvider } from '@orthacms/media-provider-local';
// ortha:end
// ortha:if media-s3
import { createS3StorageProvider } from '@orthacms/media-provider-s3';
// ortha:end
// ortha:if media-azure
import { createAzureStorageProvider } from '@orthacms/media-provider-azure';
// ortha:end
// ortha:if media-gcs
import { createGcsStorageProvider } from '@orthacms/media-provider-gcs';
// ortha:end
// ortha:if media-vercel-blob
import { createVercelBlobStorageProvider } from '@orthacms/media-provider-vercel-blob';
// ortha:end
import { UsersPlugin } from '@orthacms/users-server';
import { AlarmsPlugin } from '@orthacms/alarms-server';
import { SegmentsPlugin } from '@orthacms/segments-server';
import { ProtectionPlugin } from '@orthacms/protection-server';
import { TransferPlugin } from '@orthacms/transfer-server';
import { WebhooksPlugin } from '@orthacms/webhooks-server';
// ortha:if graphql
import { ContentGraphqlPlugin } from '@orthacms/content-graphql';
// ortha:end
// ortha:if mcp
import { McpPlugin } from '@orthacms/mcp-server';
// ortha:end
import {
    CopilotPlugin,
    type ProviderRegistration
} from '@orthacms/copilot-server';
// ortha:if copilot-anthropic
import { createAnthropicProvider } from '@orthacms/copilot-provider-anthropic';
// ortha:end
// ortha:if copilot-openai
import { createOpenAiProvider } from '@orthacms/copilot-provider-openai';
// ortha:end
import { WorkspacesPlugin } from '@orthacms/workspaces-server';
import type { OrthaConfig } from '../ortha.config';

/**
 * The model backends this deployment can actually reach, in preference order.
 *
 * **Only what is configured is registered.** `ortha.config.ts` omits a provider
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
// ortha:if sso
/**
 * The identity providers this app can actually reach.
 *
 * **Only what is configured is registered.** `ortha.config.ts` omits a provider
 * whose connection settings are missing, and an unconfigured one is skipped
 * here too — it would appear on the sign-in page as a button that can only
 * fail.
 *
 * Running two directories at once is another entry. The name is what
 * `/api/auth/sso/<name>/start` and every `sso_identities` row refer to the
 * provider by, so renaming a registration orphans its links. Register the
 * callback URL `<publicBaseUrl>/api/auth/sso/<name>/callback` with the
 * provider; `ssoCallbackUrl` from `@orthacms/identity-server` builds the exact
 * string, which matters because most providers match it byte for byte.
 */
export function ssoProviders(config: OrthaConfig): SsoRegistration[] {
    const configured = config.plugins.identity.ssoProviders;
    const providers: SsoRegistration[] = [];
    // ortha:if sso-oidc
    if (configured?.oidc) {
        const { name, ...settings } = configured.oidc;
        providers.push({ name, provider: createOidcProvider(settings) });
    }
    // ortha:end
    // ortha:if sso-github
    if (configured?.github) {
        const { name, ...settings } = configured.github;
        providers.push({ name, provider: createGithubProvider(settings) });
    }
    // ortha:end
    // ortha:if sso-saml
    if (configured?.saml) {
        const { name, ...settings } = configured.saml;
        providers.push({ name, provider: createSamlProvider(settings) });
    }
    // ortha:end

    return providers;
}
// ortha:end

export function copilotProviders(config: OrthaConfig): ProviderRegistration[] {
    const providers: ProviderRegistration[] = [];
    // ortha:if copilot-anthropic
    if (config.plugins.copilot.providers.claude) {
        providers.push({
            name: 'claude',
            provider: createAnthropicProvider(
                config.plugins.copilot.providers.claude
            )
        });
    }
    // ortha:end
    // ortha:if copilot-openai
    if (config.plugins.copilot.providers.openai) {
        providers.push({
            name: 'openai',
            provider: createOpenAiProvider(
                config.plugins.copilot.providers.openai
            )
        });
    }
    // ortha:end

    return providers;
}

// ortha:if mail
/**
 * The mail plugin, or nothing — spelled as a list so the composition below
 * stays a flat array rather than growing a conditional inside the one literal
 * meant to read as "what this app runs".
 *
 * **Only a configured backend is registered.** `ortha.config.ts` returns no
 * mail config at all unless `MAIL_PROVIDER` names one, and this returns nothing
 * in that case — so the app boots with no queue and no worker, and the invite
 * and reset routes keep handing the link back for you to pass on. There is no
 * fallback adapter here on purpose: one that wrote messages to the log would
 * make every invitation *look* sent and reach nobody.
 */
function mailPlugin(config: OrthaConfig): ServerPlugin[] {
    const mail = config.plugins.mail;
    if (!mail) return [];

    return [
        MailServerPlugin({
            // This line is the single place that selects the backend, the way
            // media's `provider:` selects storage. Swapping relay technology is
            // swapping this expression and the type on `AppMailConfig`.
            // ortha:if mail-smtp
            provider: createSmtpMailProvider(mail.smtp),
            // ortha:end
            config: mail
        })
    ];
}
// ortha:end

/**
 * This app's composition — the whole of what its API is.
 *
 * **The order is migration order.** Migrations are applied by walking this
 * array, with no transaction spanning plugins, so a plugin whose tables
 * reference another's must come after it. `WorkspacesPlugin` follows
 * `IdentityPlugin` because its `memberships` table FK-references identity's
 * `users`: put it first and a *fresh* `ortha migrate` fails with
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
export function buildPlugins(config: OrthaConfig): ServerPlugin[] {
    // No content types yet — see the note below. Held in a variable because
    // the GraphQL adapter takes the plugin itself, not just its types.
    const content = ContentPlugin({ types: [] });

    return [
        // First: the only plugin that opens a resource in `onPluginInit`.
        DatabasePlugin({
            connectionString: config.database.url,
            outboxRetentionDays: config.database.outboxRetentionDays
        }),
        // ortha:if sso
        // Identity, plus the identity providers this app offers. The second
        // argument is where constructed adapters go: `ortha.config.ts` holds
        // the typed view of the environment, and an adapter instance is not an
        // environment value.
        IdentityPlugin(config.plugins.identity, {
            sso: { providers: ssoProviders(config) }
        }),
        // ortha:end
        // ortha:ifnot sso
        IdentityPlugin(config.plugins.identity),
        // ortha:end
        WorkspacesPlugin(),
        ActivityPlugin(),
        // ortha:if mail
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
        // ortha:end
        UsersPlugin(),
        // No content types yet. Define some in `apps/server/src/content/`, pass
        // them here as `types`, then add a `drizzle.config.ts` pointing at them and
        // a `migrations` descriptor so `ortha generate` / `ortha migrate` can
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
        // ortha:if graphql
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
        // ortha:end
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
            // ortha:if media-local
            provider: createLocalStorageProvider(config.plugins.media.storage),
            // ortha:end
            // ortha:if media-s3
            provider: createS3StorageProvider(config.plugins.media.storage),
            // ortha:end
            // ortha:if media-azure
            provider: createAzureStorageProvider(config.plugins.media.storage),
            // ortha:end
            // ortha:if media-gcs
            provider: createGcsStorageProvider(config.plugins.media.storage),
            // ortha:end
            // ortha:if media-vercel-blob
            provider: createVercelBlobStorageProvider(
                config.plugins.media.storage
            ),
            // ortha:end
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
        // ortha:if mcp
        // The Model Context Protocol front door, registered LAST because it
        // serves whatever the plugins above contributed. Off unless
        // MCP_ENABLED=true: it hands an external agent the same content CRUD a
        // full-scope token has.
        McpPlugin({ config: config.plugins.mcp })
        // ortha:end
    ];
}
