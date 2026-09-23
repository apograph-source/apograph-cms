/**
 * What a generated app is made of.
 *
 * **This file is the contract between the release and the scaffolder.** Every
 * published `@orthacms/*` package is accounted for here exactly once — as core,
 * as part of an optional feature, or as deliberately transitive — and
 * `features.spec.ts` fails the build when one is not. That guard is the point:
 * adding a package to the workspace should force a decision about whether a new
 * app gets it, rather than the template quietly falling a release behind.
 *
 * Versions are *not* listed. Every `@orthacms/*` dependency is pinned to the
 * scaffolder's own version at render time (`__ORTHACMS_VERSION__`), so a release
 * bumps the whole set with no edit here.
 */

/** An optional capability a new app can opt into. */
export interface Feature {
    /** Stable id — used by `orthacms:if` blocks in the templates and by flags. */
    id: string;
    /** What the picker shows. */
    label: string;
    /** One line under the label. */
    hint: string;
    /** `@orthacms/*` packages added to the app when this is enabled. */
    packages: readonly string[];
    /** Whether it starts ticked. */
    enabledByDefault: boolean;
    /**
     * `false` for a capability that exists in the codebase but has no published,
     * working adapter yet. Shown greyed out and unselectable rather than hidden,
     * so the picker tells the truth about what is coming.
     */
    available: boolean;
    /**
     * Always on, and shown ticked but unselectable. For REST, which is not a
     * choice — it is what the other protocols adapt.
     */
    locked?: boolean;
}

/**
 * The packages every app gets, whatever it opts into.
 *
 * The **copilot** is here — plugin and admin panel — even though it is a large
 * feature nobody may want, because its server half arrives anyway: five core
 * plugins (`content`, `i18n`, `media`, `segments`, `users`) depend on
 * `copilot-server` to contribute their tools, so the code is on disk whatever
 * the manifest says, and leaving it undeclared bought nothing but a missing chat
 * panel. No **model backend** comes with it: those are the opt-in
 * `COPILOT_PROVIDERS` below, and an app that picks none has the plugin
 * installed and nothing registered. `COPILOT_ENABLED` stays `false`, which
 * unregisters the copilot's routes, so a generated app ships with the chat
 * surfaces absent rather than visible and refusing — and turning it on without
 * a configured backend fails at boot rather than shipping a chat that cannot
 * answer.
 *
 * The **extension points** are here for the same reason — `content-domain`,
 * `copilot-domain`, `segments-domain`, `transfer-domain`, `webhooks-domain`,
 * `tools-server`, `query-builder-admin`. Every one of them
 * already arrives transitively, so an import would resolve on npm's flat
 * `node_modules` today; declaring them is what makes that resolution something
 * the app owns rather than something it borrows. An undeclared import breaks
 * the moment a version conflict nests a copy, and never resolves under pnpm at
 * all.
 *
 * **SSO** contributes two entries on the same reasoning as the copilot's.
 * `identity-domain` is an extension point — the `SsoProvider` port an operator
 * implements to reach an identity provider we do not ship an adapter for — and
 * it already arrives transitively through `identity-server`, so declaring it is
 * what makes that resolution something the app owns rather than borrows.
 * `identity-provider-fake` is the scripted identity provider: it needs no
 * tenant and no network, so it is how a generated app's sign-in page can be
 * exercised offline. Note that shipping it installs nothing: an adapter only
 * does something once the composition root registers it, and the template
 * registers none.
 *
 * **Mail** contributes three on the same reasoning twice over. `mail-domain` is
 * the `MailProvider` port an operator implements to reach a backend we ship no
 * adapter for, and it arrives transitively through `mail-server` and
 * `mail-provider-smtp` alike. `mail-provider-console` and
 * `mail-provider-testkit` are the `identity-provider-fake` case
 * ([ADR-0018](https://github.com/ortha-source/ortha-cms/blob/main/docs/adr/0018-mail-provider.md) §6): shipped with every app,
 * offered in no picker, named by no template — the console adapter is how a
 * developer reads an invitation link out of their own dev log, and it is never
 * a deployment, because a "sent" message nobody receives is worse than one the
 * API still hands back. What is *not* here is the plugin itself: `mail-server`
 * and `mail-provider-smtp` ride the mail question below, so an app that
 * configures no mail installs no queue and no relay client.
 *
 * `media-domain` is the storage port, on the same reasoning again: it is what
 * an operator implements to write a `StorageProvider` for a backend we ship no
 * adapter for, and it arrives transitively through both `media-server` and
 * whichever `media-provider-*` the app chose. It is also the package that makes
 * that choice cheap — the port lives away from the server precisely so
 * installing an adapter installs an adapter.
 *
 * `design-system`, `utils-admin` and `utils-server` are here even though the
 * template's own files barely touch them: they are the first things anyone
 * reaches for when writing a page or a plugin of their own, and relying on
 * npm's hoisting to make an undeclared import work is a phantom dependency —
 * it resolves until a version conflict nests a copy, and never resolves under
 * pnpm at all.
 */
export const CORE_PACKAGES: readonly string[] = [
    '@orthacms/activity-admin',
    '@orthacms/activity-server',
    '@orthacms/alarms-admin',
    '@orthacms/alarms-server',
    '@orthacms/api-tokens-admin',
    '@orthacms/bootstrap-admin',
    '@orthacms/bootstrap-server',
    '@orthacms/content-admin',
    '@orthacms/content-domain',
    '@orthacms/content-server',
    '@orthacms/copilot-admin',
    '@orthacms/copilot-domain',
    '@orthacms/copilot-server',
    '@orthacms/database',
    '@orthacms/design-system',
    '@orthacms/i18n-admin',
    '@orthacms/i18n-server',
    '@orthacms/identity-admin',
    '@orthacms/identity-domain',
    '@orthacms/identity-provider-fake',
    '@orthacms/identity-server',
    '@orthacms/insights-admin',
    '@orthacms/mail-domain',
    '@orthacms/mail-provider-console',
    '@orthacms/mail-provider-testkit',
    '@orthacms/media-admin',
    '@orthacms/media-domain',
    '@orthacms/media-server',
    '@orthacms/protection-admin',
    '@orthacms/protection-domain',
    '@orthacms/protection-server',
    '@orthacms/query-builder-admin',
    '@orthacms/segments-admin',
    '@orthacms/segments-domain',
    '@orthacms/segments-server',
    '@orthacms/shell-admin',
    '@orthacms/tools-server',
    '@orthacms/transfer-admin',
    '@orthacms/transfer-domain',
    '@orthacms/transfer-server',
    '@orthacms/users-admin',
    '@orthacms/users-server',
    '@orthacms/utils-admin',
    '@orthacms/utils-server',
    '@orthacms/webhooks-admin',
    '@orthacms/webhooks-domain',
    '@orthacms/webhooks-server',
    '@orthacms/workspaces-admin',
    '@orthacms/workspaces-server',
    '@orthacms/wysiwyg-admin'
];

/** Packages the app needs to build and run itself, as devDependencies. */
export const CORE_DEV_PACKAGES: readonly string[] = ['@orthacms/cli'];

/**
 * Packages deliberately left undeclared — published, but with no reason for a
 * generated app to import them **yet**.
 *
 * The two `media-*` entries are here for the ordinary reason: they are
 * tools for **writing a storage provider**, not for running one. `StorageProviderCheck` refuses to boot a database whose rows
 * were written by a provider that is no longer configured, so the in-memory
 * backend is a test and offline-development affordance, never a deployment:
 * offering it in the scaffolder would be offering an app that loses every
 * upload on restart. The testkit is the contract suite those providers run
 * against.
 *
 * Everything else a generated app can reach is in its own manifest, so "it
 * resolves because npm hoisted it" is never the answer to why an import works.
 * Putting a package here is a decision the coverage guard accepts; forgetting
 * it entirely is not.
 */
export const TRANSITIVE_PACKAGES: readonly string[] = [
    '@orthacms/media-provider-memory',
    '@orthacms/media-provider-testkit'
];

/**
 * Where uploads are written.
 *
 * A single-choice group: media always runs, the question is only which adapter
 * backs it. All five are published and selectable; `available` stays on the
 * type for the next adapter that lands in the codebase before it lands on npm,
 * which is shown greyed out rather than hidden.
 */
export const MEDIA_PROVIDERS: readonly Feature[] = [
    {
        id: 'media-local',
        label: 'Local filesystem',
        hint: 'Writes to a directory on disk. Point MEDIA_LOCAL_ROOT at a volume in production.',
        packages: ['@orthacms/media-provider-local'],
        enabledByDefault: true,
        available: true
    },
    {
        id: 'media-azure',
        label: 'Azure Blob Storage',
        hint: 'Set MEDIA_AZURE_CONTAINER and a connection string. Managed identity needs a hand-built client — see the package docs.',
        packages: ['@orthacms/media-provider-azure'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'media-gcs',
        label: 'Google Cloud Storage',
        hint: 'Native GCS auth. If an HMAC key is acceptable, the S3-compatible adapter reaches GCS too — one package fewer.',
        packages: ['@orthacms/media-provider-gcs'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'media-vercel-blob',
        label: 'Vercel Blob',
        hint: 'Smallest setup on Vercel — but every blob gets a permanent public URL, so not for confidential media.',
        packages: ['@orthacms/media-provider-vercel-blob'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'media-s3',
        label: 'S3-compatible',
        hint: 'Cloudflare R2, AWS S3, MinIO, Spaces, B2, Wasabi — set MEDIA_S3_BUCKET and, for anything but AWS, MEDIA_S3_ENDPOINT.',
        packages: ['@orthacms/media-provider-s3'],
        enabledByDefault: false,
        available: true
    }
];

/**
 * Model backends for the AI copilot.
 *
 * A multi-choice group, and picking none is the meaningful default: enabling a
 * hosted provider sends workspace content to a third party, which
 * [ADR-0005](https://github.com/ortha-source/ortha-cms/blob/main/docs/adr/0005-copilot-authority-model.md)
 * §10 says is an operator's decision to make explicitly. Pick nothing and the
 * copilot is not registered at all.
 *
 * There is no offline stand-in to fall back on. The scripted `fake` adapter is
 * a private test fixture of the CMS repo, not a published package, so an app
 * that picks nothing here has the copilot plugin installed with no backend
 * registered — and `COPILOT_ENABLED` must stay `false` until one is.
 */
export const COPILOT_PROVIDERS: readonly Feature[] = [
    {
        id: 'copilot-anthropic',
        label: 'Claude (Anthropic)',
        hint: 'Native Claude. Needs ANTHROPIC_API_KEY.',
        packages: ['@orthacms/copilot-provider-anthropic'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'copilot-openai',
        label: 'OpenAI-compatible endpoint',
        hint: 'Ollama, vLLM, LiteLLM, Azure or OpenAI. Needs COPILOT_OPENAI_BASE_URL.',
        packages: ['@orthacms/copilot-provider-openai'],
        enabledByDefault: false,
        available: true
    }
];

/**
 * How people sign in to the admin.
 *
 * A single opt-in, and off by default, because SSO is not something a CMS can
 * usefully guess at: it needs an issuer, a client and a callback URL registered
 * on the other side, none of which a scaffolder can invent. A generated app
 * without it signs in with email and password, which is the invite-only flow
 * Ortha CMS has always had.
 *
 * **One entry covers most of the field.** Okta, Auth0, Keycloak, Google, Entra
 * ID, Authentik, Zitadel, JumpCloud, Ping and GitLab all speak OpenID Connect,
 * and the named vendors are preset factories inside that one package rather
 * than packages of their own — the SSO equivalent of the copilot's
 * OpenAI-compatible adapter.
 *
 * The other two are here because their **wire** genuinely differs, which is the
 * only thing that earns a package: GitHub is OAuth2 with no identity token, and
 * SAML is a POST binding with XML signatures. Each also brings its own
 * dependency — `jose` for OIDC, `@node-saml/node-saml` for SAML — which is a
 * second reason not to install them for an app that will never speak them.
 *
 * `identity-provider-fake` is not offered: it is installed unconditionally,
 * because it needs no tenant and no network and is how a generated app's
 * sign-in page is exercised offline. Installing it
 * registers nothing — an adapter only does something once the composition root
 * names it, and the template names none.
 */
export const SSO_PROVIDERS: readonly Feature[] = [
    {
        id: 'sso-oidc',
        label: 'OpenID Connect single sign-on',
        hint: 'Okta, Auth0, Keycloak, Google, Entra ID and the rest. Needs SSO_OIDC_ISSUER and SSO_OIDC_CLIENT_ID.',
        packages: ['@orthacms/identity-provider-oidc'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'sso-github',
        label: 'GitHub sign-in',
        hint: 'GitHub or GitHub Enterprise Server. Needs SSO_GITHUB_CLIENT_ID and SSO_GITHUB_CLIENT_SECRET.',
        packages: ['@orthacms/identity-provider-github'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'sso-saml',
        label: 'SAML 2.0 single sign-on',
        hint: 'For an identity provider that speaks SAML rather than OIDC. Needs the IdP certificate and entry point.',
        packages: ['@orthacms/identity-provider-saml'],
        enabledByDefault: false,
        available: true
    }
];

/**
 * How the content API is spoken.
 *
 * REST is always there and is shown `locked` rather than hidden, because "which
 * protocols does this app serve" is a more useful question than "do you want
 * these two extras" — the answer should read as a set, with the one you always
 * get visible in it.
 *
 * Neither addition brings a credential or a permission of its own: GraphQL is
 * an adapter over the REST API's own services
 * ([ADR-0008](https://github.com/ortha-source/ortha-cms/blob/main/docs/adr/0008-graphql-as-a-protocol-adapter.md)),
 * and MCP reuses the same API tokens and scopes. They are opt-in because an
 * endpoint nobody asked for is still an endpoint.
 */
export const PROTOCOLS: readonly Feature[] = [
    {
        id: 'rest',
        label: 'REST',
        hint: 'Always on — /api/v1/…, the API every other protocol adapts.',
        packages: [],
        enabledByDefault: true,
        available: true,
        locked: true
    },
    {
        id: 'graphql',
        label: 'GraphQL content API',
        hint: 'POST /api/v1/graphql, alongside REST. Same tokens, same scopes.',
        packages: ['@orthacms/content-graphql'],
        enabledByDefault: false,
        available: true
    },
    {
        id: 'mcp',
        label: 'MCP server',
        hint: 'Lets an external agent do content CRUD with an API token. Off unless MCP_ENABLED=true.',
        packages: ['@orthacms/mcp-server'],
        enabledByDefault: false,
        available: true
    }
];

/**
 * How the app sends invitations and password resets.
 *
 * The one question whose default answer is **nothing**, and the only
 * single-choice group that offers it: a deployment sends through exactly one
 * relay, and plenty of them send through none. Pick nothing and the app behaves
 * as the product always has — the invite response carries the raw link for an
 * administrator to pass on by hand, with no queue, no worker and no
 * `MAIL_PROVIDER` to set ([ADR-0018](https://github.com/ortha-source/ortha-cms/blob/main/docs/adr/0018-mail-provider.md)).
 *
 * **One entry covers the market**, the way the OIDC adapter covers the identity
 * vendors: Resend, SES, Postmark, SendGrid, Mailgun, Google Workspace,
 * Microsoft 365 and any relay inside a perimeter all speak SMTP. A vendor HTTP
 * adapter earns a package of its own when the wire genuinely differs, and each
 * one that lands joins this list — greyed out through `available: false` until
 * it is published, the same as any other adapter.
 *
 * `mail-provider-console` and `mail-provider-testkit` are offered **nowhere**.
 * They are installed unconditionally and registered by no template: the console
 * adapter writes a message to the log, which is exactly right while developing
 * and exactly wrong in production, where it would make every invitation look
 * sent and reach nobody. That is ORT-148's mistake with an invitation attached,
 * and the picker is where it would have been made.
 *
 * `mail-server` rides with the adapter rather than sitting in
 * {@link CORE_PACKAGES}: the plugin is registered only when a backend is
 * configured, so an app that picked nothing has no use for it — and a core
 * package that defines a plugin factory has to be mounted unconditionally
 * (`composition.spec.ts`), which this one must not be. When a second adapter
 * lands it needs `mail-server` too, and the "no package in two groups" guard
 * will say so: hoist it to a shared list at that point rather than repeating
 * it.
 */
export const MAIL_PROVIDERS: readonly Feature[] = [
    {
        id: 'mail-smtp',
        label: 'SMTP relay',
        hint: 'Resend, SES, Postmark, SendGrid, Mailgun, Google Workspace, or a relay of your own. Needs SMTP_HOST, MAIL_FROM and APP_URL.',
        packages: ['@orthacms/mail-server', '@orthacms/mail-provider-smtp'],
        enabledByDefault: false,
        available: true
    }
];

/** Every optional feature, in the order the wizard asks about them. */
export const ALL_FEATURES: readonly Feature[] = [
    ...MEDIA_PROVIDERS,
    ...COPILOT_PROVIDERS,
    ...SSO_PROVIDERS,
    ...PROTOCOLS,
    ...MAIL_PROVIDERS
];

/** The answers a scaffold run resolves to. */
export interface FeatureSelection {
    /** Ids of every enabled feature — what `orthacms:if` blocks are tested against. */
    enabled: ReadonlySet<string>;
}

/**
 * The `@orthacms/*` dependencies for a selection, sorted.
 *
 * Built here rather than with `orthacms:if` blocks inside `package.json.tmpl`:
 * removing lines from JSON is how you get a trailing comma and an app that
 * cannot even be installed, and the failure would name the template rather than
 * the feature that was switched off.
 */
export function resolvePackages(selection: FeatureSelection): string[] {
    const packages = new Set(CORE_PACKAGES);

    for (const feature of ALL_FEATURES) {
        if (!selection.enabled.has(feature.id)) continue;
        for (const name of feature.packages) packages.add(name);
    }

    return [...packages].sort();
}

/** The dev-time `@orthacms/*` dependencies, sorted. */
export function resolveDevPackages(): string[] {
    return [...CORE_DEV_PACKAGES].sort();
}

/**
 * The feature ids in force for a selection — what `orthacms:if` tests against.
 *
 * The picked ids, plus **two** derived group flags: `sso`, set when any
 * `sso-*` provider was chosen, and `mail`, set when any `mail-*` one was.
 *
 * It exists because `orthacms:if` is deliberately line-based with no expression
 * language, so a block cannot say "any of these three". Three providers share
 * one `ssoProviders` key in the config, one builder function in `plugins.ts`
 * and one extra argument to `IdentityPlugin` — each of which has to appear if
 * *any* of them was picked, and none of which may be left behind as an empty
 * husk when none was. `sso` is that condition, and it is derived here rather
 * than added to the picker so it can never be selected on its own.
 *
 * `mail` is the same shape one adapter earlier: `config/mail.ts`, the
 * `mailPlugin` helper, the `OrthaCmsConfig.plugins.mail` field and the shared
 * `MAIL_*` keys belong to *mail*, not to SMTP, and the second adapter must not
 * be the commit that discovers it.
 */
export function resolveFlags(selection: FeatureSelection): Set<string> {
    const flags = new Set(selection.enabled);

    if (SSO_PROVIDERS.some((provider) => flags.has(provider.id))) {
        flags.add('sso');
    }
    if (MAIL_PROVIDERS.some((provider) => flags.has(provider.id))) {
        flags.add('mail');
    }

    return flags;
}
