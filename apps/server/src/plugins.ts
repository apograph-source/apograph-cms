import { join } from 'node:path';
import type { ServerPlugin } from '@apograph/bootstrap-server';
import { ActivityPlugin } from '@apograph/activity-server';
import { ContentPlugin, ContentViewsPlugin } from '@apograph/content-server';
import { ContentGraphqlPlugin } from '@apograph/content-graphql';
import {
    CopilotPlugin,
    type ProviderRegistration
} from '@apograph/copilot-server';
import { createAnthropicProvider } from '@apograph/copilot-provider-anthropic';
import { createOpenAiProvider } from '@apograph/copilot-provider-openai';
import { DatabasePlugin } from '@apograph/database';
import { I18nServerPlugin } from '@apograph/i18n-server';
import { IdentityPlugin } from '@apograph/identity-server';
import { createOidcProvider } from '@apograph/identity-provider-oidc';
import { createGithubProvider } from '@apograph/identity-provider-github';
import { createSamlProvider } from '@apograph/identity-provider-saml';
import { MailServerPlugin } from '@apograph/mail-server';
import { createSmtpMailProvider } from '@apograph/mail-provider-smtp';
import { createConsoleMailProvider } from '@apograph/mail-provider-console';
import { McpPlugin } from '@apograph/mcp-server';
import { MediaServerPlugin } from '@apograph/media-server';
import { TransferPlugin } from '@apograph/transfer-server';
import { AlarmsPlugin } from '@apograph/alarms-server';
import { SegmentsPlugin } from '@apograph/segments-server';
import { ProtectionPlugin } from '@apograph/protection-server';
import { WebhooksPlugin } from '@apograph/webhooks-server';
import { createLocalStorageProvider } from '@apograph/media-provider-local';
import { UsersPlugin } from '@apograph/users-server';
import { WorkspacesPlugin } from '@apograph/workspaces-server';
import type { ApographConfig } from '../apograph.config';
import type { SsoRegistration } from '@apograph/identity-domain';
import type { MailProvider } from '@apograph/mail-domain';
import { contentTypes } from './content';

/**
 * The copilot backends this deployment can actually reach, in preference
 * order.
 *
 * **Only what is configured is registered.** `apograph.config.ts` omits a
 * provider whose connection settings are absent, and an unconfigured backend
 * is not registered here either: the first entry is what a run that names no
 * provider gets, so a keyless `claude` at the top of the list would be the
 * house default and would fail on the first message.
 *
 * **A clone with no keys gets an empty list**, and therefore no copilot: there
 * is no scripted offline adapter in this list any more. The fake provider is a
 * test fixture (`@apograph/copilot-provider-fake`, private and unpublished) and
 * registering it here made a misconfigured production deployment answer every
 * question with a canned sentence instead of failing. `COPILOT_ENABLED` is off
 * by default, so an empty list is the ordinary state of a fresh clone and boots
 * fine; turning the copilot on with no backend configured fails at boot, where
 * it is cheapest to diagnose.
 *
 * **Exported for `plugins.spec.ts`.** The order this returns is what decides
 * the house default, and it is unreachable from the outside otherwise: the
 * plugin object carries its `copilotConfig`, not its providers, and `server-e2e`
 * builds its own plugin list rather than calling `buildPlugins`. So a config
 * threaded into the wrong factory here would have passed every test in the
 * repo.
 */
export function copilotProviders(
    config: ApographConfig
): ProviderRegistration[] {
    const { claude, ollama } = config.plugins.copilot.providers;
    return [
        ...(claude
            ? [{ name: 'claude', provider: createAnthropicProvider(claude) }]
            : []),
        ...(ollama
            ? [{ name: 'ollama', provider: createOpenAiProvider(ollama) }]
            : [])
    ];
}

/**
 * The identity providers this deployment can actually reach.
 *
 * **Only what is configured is registered.** `apograph.config.ts` omits a provider
 * whose issuer or client id is missing, and an unconfigured provider is not
 * registered here either — it would appear on the sign-in page as a button that
 * can only fail, and every SSO failure deliberately looks the same, so the
 * person clicking it would learn nothing.
 *
 * No scripted provider is registered here. `@apograph/identity-provider-fake`
 * ships and is what `server-e2e` registers, but a scripted identity provider in
 * a running deployment signs people in without anyone authenticating, so the
 * host does not register one — the same reason the copilot's fake adapter is
 * now a private test fixture rather than something this file wires up.
 *
 * **Exported for `plugins.spec.ts`.** The plugin object carries its
 * `identityConfig`, not its providers, so a config threaded into the wrong
 * factory here would otherwise pass every test in the repo.
 *
 * Running two directories at once is another entry:
 *
 *     { name: 'contractors', provider: createOidcProvider({ … }) }
 *
 * The name is what `/api/auth/sso/<name>/start` and every `sso_identities` row
 * refer to the provider by, so renaming a registration orphans its links.
 * `ssoCallbackUrl(config.plugins.identity, name)` from
 * `@apograph/identity-server` builds the exact callback URL to register with
 * the provider — exact because most providers match that string byte for byte,
 * and a trailing slash makes it a different URL to them.
 */
export function ssoProviders(config: ApographConfig): SsoRegistration[] {
    const { oidc, github, saml } = config.plugins.identity.ssoProviders;
    const registrations: SsoRegistration[] = [];

    if (oidc) {
        const { name, ...settings } = oidc;
        registrations.push({ name, provider: createOidcProvider(settings) });
    }
    if (github) {
        const { name, ...settings } = github;
        registrations.push({ name, provider: createGithubProvider(settings) });
    }
    if (saml) {
        const { name, ...settings } = saml;
        registrations.push({ name, provider: createSamlProvider(settings) });
    }

    // Order is presentation: it is the order the sign-in page shows its
    // buttons in, and nothing else. Unlike the copilot's model providers there
    // is no "first one is the default" — a person picks a button.
    return registrations;
}

/**
 * The mail backend this deployment sends through, or `null` for one that sends
 * nothing.
 *
 * **Only what is configured is constructed.** `apograph.config.ts` returns no
 * mail config at all unless `MAIL_PROVIDER` names a backend, and this returns
 * `null` in that case — so a fresh clone registers no mail plugin, keeps the
 * invite and reset routes returning the raw token, and behaves exactly as the
 * product did before ADR-0018. There is no "default" adapter here for the same
 * reason there is no default copilot backend: the offline one would make
 * invitations *look* sent and be received by nobody (ORT-148 is that mistake
 * with a copilot attached).
 *
 * **Exported for `plugins.spec.ts`.** The plugin object carries its
 * `mailConfig`, not its provider, so a config threaded into the wrong factory
 * here would otherwise pass every test in the repo.
 */
export function mailProvider(config: ApographConfig): MailProvider | null {
    const mail = config.plugins.mail;
    if (!mail) return null;
    if (mail.backend === 'console') {
        return createConsoleMailProvider();
    }
    if (!mail.smtp) {
        // Unreachable through `mailConfig()`, which fills the block in whenever
        // it returns `backend: 'smtp'` — but this is the composition root, and
        // a silent fall-through to the console adapter here is precisely the
        // failure this file refuses elsewhere: mail that looks sent and reaches
        // nobody.
        throw new Error(
            'MAIL_PROVIDER=smtp but no SMTP connection settings were built — set SMTP_HOST.'
        );
    }
    return createSmtpMailProvider(mail.smtp);
}

/**
 * Builds the host's plugin list. Shared by `main.ts` (boot) and the
 * `db:migrate` target (which reads each plugin's `migrations` descriptor),
 * so both see exactly the same plugins, in the same order.
 *
 * **What the order actually decides.** Not dependency injection: every plugin
 * module is global, and `createServer` runs every `onPluginInit` before
 * `NestFactory.create`, so no provider can be constructed before the database
 * connection is open regardless of position. Measured: moving `IdentityPlugin`
 * above `DatabasePlugin` boots and serves normally. `DatabasePlugin` is
 * nonetheless listed first because it is the only plugin that opens a resource
 * in `onPluginInit`, and the moment a second one does, that hook order — which
 * *is* array order — becomes load-bearing with nothing to catch a mistake.
 *
 * What the order does decide is **migration order**: `applyPluginMigrations`
 * walks this array, with no transaction spanning plugins, so a plugin whose
 * tables reference another's must come after it. `WorkspacesPlugin` follows
 * identity because `memberships` FK-references identity's `users`; moving it
 * above fails a *fresh* migrate with `relation "users" does not exist` and
 * migrates an already-migrated database happily — so the mistake ships and bites
 * the next clean install. `apps/server/src/plugins.spec.ts` asserts the
 * ordering; ORT-131 tracks making it a declaration rather than a comment.
 *
 * The rest is intent, and reads in dependency order for that reason:
 * `WorkspacesPlugin` precedes `ContentPlugin`, which scopes routes with its
 * `WorkspaceGuard` and binds its `CONTENT_CATALOG` / `CONTENT_ENTRY_COUNTER`
 * ports; `ActivityPlugin`'s read API is gated by identity's guard plus
 * `activity:read`, and workspaces records audit events through the globally-bound
 * recorder; `UsersPlugin` reads identity's and workspaces' tables and records
 * through activity; `I18nServerPlugin` follows `ContentPlugin` because it binds
 * content's `CONTENT_ENTRY_EXTENSION` port and reads its registry. Those ports
 * are injected `@Optional()`, so **removing** one of these plugins degrades
 * silently rather than failing boot — which is what `plugins.spec.ts` pins the
 * membership of this list for.
 */
/**
 * The mail plugin, or nothing — spelled as a list so the composition below
 * stays a flat array of registrations rather than growing a conditional inside
 * the one literal that is meant to read as "what this deployment runs".
 */
function mailPlugin(config: ApographConfig): ServerPlugin[] {
    const provider = mailProvider(config);
    const mail = config.plugins.mail;
    if (!provider || !mail) return [];
    return [MailServerPlugin({ provider, config: mail })];
}

export function buildPlugins(config: ApographConfig): ServerPlugin[] {
    const content = ContentPlugin({
        types: contentTypes,
        // The HOST owns the generated collection tables (drizzle.config.ts
        // diffs src/content/index.ts into ./migrations); routing the
        // descriptor through the plugin lets the standard db:migrate
        // machinery apply them with every other plugin's migrations.
        migrations: {
            dir: () => join(__dirname, '../migrations'),
            table: '__drizzle_migrations_content'
        }
    });
    return [
        DatabasePlugin({ connectionString: config.database.url }),
        // Identity, plus the identity providers this deployment offers.
        //
        // The second argument is where **constructed** adapters go, the same
        // way the copilot's model backends do: `apograph.config.ts` holds the
        // typed view of the environment, and an adapter instance is not an
        // environment value. A default install configures none, so
        // `GET /api/auth/sso` answers `[]` and the sign-in page shows only the
        // password form.
        //
        // To let the directory decide roles, add a `resolveRole` handler here —
        // plain code, returning a role key or `null` to leave the role alone:
        //
        //   resolveRole: ({ profile, isNewAccount }) =>
        //       isNewAccount && profile.groups?.includes('cms-editors')
        //           ? 'contributor'
        //           : null,
        //
        // Without one the CMS never infers authority from a claim, which is the
        // default: a mapping that ran on every sign-in would silently undo an
        // administrator's edit, with nothing in the product to say why it did
        // not stick. An account already holding `admin` is never demoted by a
        // handler either — that grant is deliberate, and a directory group is
        // not.
        IdentityPlugin(config.plugins.identity, {
            sso: { providers: ssoProviders(config) }
        }),
        WorkspacesPlugin(),
        ActivityPlugin(),
        // Mail, before users: its `MAIL_DISPATCHER` is what the invite, resend
        // and reset use cases queue their messages through, and what makes
        // those routes stop returning a raw token (ADR-0018 §4). Registered
        // only when a backend is configured — with none, `users` injects
        // nothing, sends nothing, and returns the link exactly as it always
        // has.
        //
        // Module order is not what binds it (every plugin module is global),
        // but migration order is, and this list is that order: the plugin owns
        // `mail_deliveries` and ships its migrations.
        ...mailPlugin(config),
        UsersPlugin(),
        content,
        // Saved list views — a second `ServerPlugin` entry from the content
        // package, not a second package. `ServerPlugin.migrations` carries one
        // descriptor and content's is already the HOST's generated collection
        // tables, so the feature's own fixed tables ride their own entry
        // (tracked under `__drizzle_migrations_content_views`).
        //
        // Placement is load-bearing twice over: `saved_views` has foreign keys
        // into identity's `users` and workspaces' `workspaces`, and migrations
        // run in this list's order with nothing declaring that dependency; and
        // it takes `content` by value for the registry that resolves a view's
        // `content:<typeName>` scope.
        ContentViewsPlugin({ content }),
        // The same public content API over GraphQL, on `/api/v1/graphql`. It
        // owns no schema and adds no credential — it reuses content's bearer
        // guards and read/write services, so a token minted before it existed
        // works against it unchanged. Taking `content` by value lets it fail
        // boot on two content types that would collide as GraphQL names,
        // rather than on the first request from a workspace granted both.
        ContentGraphqlPlugin({
            content,
            ...config.plugins.contentGraphql,
            // GraphiQL rides the same switch as the Scalar reference: both are
            // developer tooling, and neither should be reachable in production
            // unless the operator asks (`API_DOCS=true`).
            playground: config.docs.enabled === true
        }),
        // Media — registered after workspaces (its routes use `WorkspaceGuard`)
        // and identity (its routes use `PermissionsGuard`). This line is the
        // single place that selects storage: one constructed provider, so
        // switching backend is swapping this expression (and the type of
        // `config.plugins.media.storage` with it).
        //
        // A deployment runs exactly one. The provider's own `id` is recorded on
        // every asset row, and `StorageProviderCheck` refuses to boot if the
        // library already holds assets written by a different one — those bytes
        // are in a backend this process is not connected to.
        MediaServerPlugin({
            provider: createLocalStorageProvider(config.plugins.media.storage),
            config: config.plugins.media
        }),
        I18nServerPlugin(config.plugins.i18n),
        // Export/import. After content (whose registry and entry writer it
        // uses) and after media (whose storage it reads bytes from and whose
        // upload path it recreates them with). Both are hard requirements only
        // for what they provide: without media it still runs, and media fields
        // simply travel as references.
        //
        // `identity` is the setting worth filling in per install. It says which
        // field identifies a record of each type, and it is what lets an import
        // recognise "this is that record" rather than adding a duplicate — the
        // derived fallback is a heuristic, and a catalogue keyed on `sku`
        // should say so rather than hope the heuristic agrees.
        TransferPlugin(config.plugins.transfer),
        // Alarms — non-blocking content rules. After content, whose registry,
        // filter surface and grant query it uses: a rule *is* a records-list
        // filter, evaluated through content's own `EntryMatchQuery`, so it can
        // only ever mean what the list means. It subscribes to the entry
        // lifecycle events on the shared outbox and owns two tables of its own.
        //
        // It never blocks a write, at any severity
        // ([ADR-0015](../../../docs/adr/0015-alarms-are-non-blocking.md)) —
        // that is the line that keeps it from becoming a second, competing
        // authority on whether an entry is valid.
        AlarmsPlugin(),
        // Reader entitlements. After content, whose `CONTENT_READ_SCOPE` port
        // it binds.
        //
        // Registering it changes nothing on its own: with no audience created
        // in the admin the read predicate is never emitted and every read costs
        // exactly what it did before. The `resolver` is the one line to fill in
        // per install — it says where a reader's tags come from, and its absence
        // means every reader is anonymous, which serves unrestricted content
        // and nothing else.
        SegmentsPlugin(config.plugins.segments),
        // Publication protection — a per-content-type rule requiring N
        // approvals before an entry may be published. After content, whose
        // registry and workspace grants it reads to decide which types a
        // workspace may write a rule for.
        //
        // Registering it changes nothing on its own: with no rule written in
        // the admin, publication behaves byte for byte as it does with the
        // plugin uninstalled. It takes no configuration — the rule table is the
        // whole configuration surface and its empty state is the off state.
        //
        // Its migration order is free: all three of its tables carry plain
        // uuids with no foreign key into another plugin's schema, including
        // `revision_id`, because `content_entry_revisions` is host-owned.
        ProtectionPlugin(),
        // Last of the content-adjacent plugins: it only subscribes to the
        // outbox and owns no port anything else binds, so nothing depends on
        // it being registered earlier.
        WebhooksPlugin(config.plugins.webhooks),
        // Copilot — registered after workspaces (runs are workspace-scoped)
        // and identity (runs execute as the calling user, gated on
        // `copilot:use`). Like media, the composition root is the single place
        // that selects a backend, and the plugin never learns which adapters
        // exist: it takes a list of named, already-constructed providers.
        //
        // Each provider declares several models, so a user can switch between
        // them mid-conversation, and an operator changes what is on offer by
        // changing this list — no redeploy of the copilot packages, which is
        // most of what self-hosters are asking for (ADR-0004 §5). Registering
        // two of the same kind is just another entry:
        //   { name: 'ollama-big', provider: createOpenAiProvider({ … }) },
        //
        // **The order is the setting.** There is no `defaultProvider`: the
        // first entry serves a run that names no provider (MCP, the API, e2e)
        // and is what the admin's model picker opens on. To route per run
        // instead, add a `resolve` handler, e.g.:
        //   resolve: (ctx) => (isBigWorkspace(ctx.workspaceId) ? 'claude' : 'ollama'),
        //
        // Every provider × model pair registered here is what the chat panel's
        // model picker offers (`GET /api/copilot/models`), so adding a backend
        // is an entry in this list and nothing else.
        CopilotPlugin({
            providers: copilotProviders(config),
            // Skills defined in code — reusable instruction packets available
            // in every workspace, reviewed in git and changed by a deploy
            // (ADR-0010). Workspaces author their own in the admin; a code
            // skill wins a name collision and is read-only there.
            //
            // The default install ships none, because a skill is editorial
            // guidance and nobody else's is right for your content. Adding one
            // is an entry here plus a Markdown file beside this one:
            //
            //   skills: [
            //       {
            //           name: 'house-style',
            //           title: 'House style',
            //           description:
            //               'How we write product copy: sentence case, second person.',
            //           // `always` puts it in force on every run; omit for
            //           // "only when someone attaches it in the composer".
            //           mode: 'always',
            //           instructions: readFileSync(
            //               join(__dirname, 'skills/house-style.md'),
            //               'utf8'
            //           )
            //       }
            //   ],
            config: config.plugins.copilot
        }),
        // MCP — the Model Context Protocol front door, registered LAST because
        // it serves whatever the plugins above contributed. Order is legibility
        // only: every plugin module is global, and a contributor registers its
        // tools in `onModuleInit`, once the whole graph exists.
        //
        // It owns no tools itself. `ContentPlugin` contributes the content CRUD
        // set; a future media or users provider is a `ToolProvider` in that
        // plugin and nothing at all here. The same registry is what the
        // copilot's tool loop will consume in-process, so a tool added for one
        // consumer is automatically available to the other.
        //
        // Disabled unless `MCP_ENABLED=true` — see the config's note.
        McpPlugin({ config: config.plugins.mcp })
    ];
}
