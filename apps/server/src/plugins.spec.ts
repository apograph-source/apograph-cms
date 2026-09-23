import config, {
    type OrthaCmsConfig,
    type OrthaCmsCopilotConfig
} from '../orthacms.config';
import {
    buildPlugins,
    copilotProviders,
    mailProvider,
    ssoProviders
} from './plugins';

/**
 * The shipped composition, asserted.
 *
 * `apps/server-e2e` never runs this function — it builds its own mirror
 * (`apps/server-e2e/src/support/plugins.ts`) so a change to the host's content
 * types cannot break the suite. That decoupling is right, and it leaves the real
 * registry with no test at all: a plugin dropped from the array here removes its
 * routes and silently degrades everything that injects its ports `@Optional()`
 * (measured: removing `ActivityPlugin` boots clean, logs nothing, and stops
 * writing audit rows), while the e2e run stays green because it never looked.
 *
 * So this asserts the two things about the list that are actually load-bearing —
 * who is in it, and what order the migrations run in — and nothing about DI
 * order, which is genuinely free (every plugin module is global, and every
 * `onPluginInit` runs before `NestFactory.create`).
 */

/** Every plugin the product ships, in registration order. */
const EXPECTED_PLUGINS = [
    'database',
    'identity',
    'workspaces',
    'activity',
    'users',
    'content',
    'content-views',
    'content-graphql',
    'media',
    'i18n',
    'transfer',
    'alarms',
    'segments',
    'protection',
    'webhooks',
    'copilot',
    'mcp'
];

describe('buildPlugins()', () => {
    it('registers exactly the shipped plugin set', () => {
        // A missing name is a capability that quietly stopped existing; an extra
        // one is a surface nobody decided to expose.
        expect(buildPlugins(config).map((plugin) => plugin.name)).toEqual(
            EXPECTED_PLUGINS
        );
    });

    it('orders the migration-shipping plugins so their foreign keys resolve on a fresh database', () => {
        // `applyPluginMigrations` walks this array in order, and there is no
        // outer transaction, so a plugin whose tables reference another's must
        // come after it. The mistake is invisible on an already-migrated
        // database — measured: moving `workspaces` above `identity` re-migrates
        // an existing database happily and fails a *fresh* one with
        // `relation "users" does not exist`. So it ships, and bites the next
        // clean install rather than its author.
        const migrating = buildPlugins(config)
            .filter((plugin) => plugin.migrations)
            .map((plugin) => plugin.name);

        expect(migrating.indexOf('identity')).toBeLessThan(
            migrating.indexOf('workspaces')
        );
        expect(migrating.indexOf('workspaces')).toBeLessThan(
            migrating.indexOf('activity')
        );
        // `saved_views` references identity's `users` and workspaces'
        // `workspaces`, so the views entry has to follow both.
        expect(migrating.indexOf('identity')).toBeLessThan(
            migrating.indexOf('content-views')
        );
        expect(migrating.indexOf('workspaces')).toBeLessThan(
            migrating.indexOf('content-views')
        );
    });

    it('gives every migration-shipping plugin its own tracking table [bootstrap:I-19]', () => {
        // Two plugins sharing one `__drizzle_migrations_*` table would read each
        // other's history as their own and skip their real migrations.
        const tables = buildPlugins(config)
            .filter((plugin) => plugin.migrations)
            .map((plugin) => plugin.migrations?.table);

        expect([...new Set(tables)]).toEqual(tables);
        expect(
            tables.every((table) => table?.startsWith('__drizzle_migrations_'))
        ).toBe(true);
    });

    it('keeps the content plugin and its GraphQL adapter as one registration, not two schemas', () => {
        // `ContentGraphqlPlugin` takes the *same* `content` value the registry
        // registers, which is what lets a GraphQL type-name collision fail at
        // composition instead of on the first request from a workspace granted
        // both types.
        const plugins = buildPlugins(config);
        const content = plugins.find((plugin) => plugin.name === 'content');
        const graphql = plugins.find(
            (plugin) => plugin.name === 'content-graphql'
        );

        expect(content).toBeDefined();
        expect(graphql).toBeDefined();
        // The adapter owns no schema of its own — the content plugin's
        // host-owned migrations are the only content migrations in the run.
        expect(graphql?.migrations).toBeUndefined();
        expect(content?.migrations?.table).toBe('__drizzle_migrations_content');
    });
});

/**
 * Which mail backend the shipped composition constructs — and, above all, that
 * it constructs none by default.
 *
 * `buildPlugins` runs under the ambient environment, which configures no mail,
 * so the list asserted above is deliberately the *unconfigured* one: registering
 * the mail plugin changes the API (the invite and reset routes stop returning a
 * raw token), and that has to be something a deployment opted into.
 */
describe('mailProvider()', () => {
    /** The shipped config with a mail block substituted in. */
    const withMail = (
        mail: OrthaCmsConfig['plugins']['mail']
    ): OrthaCmsConfig => ({
        ...config,
        plugins: { ...config.plugins, mail }
    });

    it('constructs nothing, and registers no plugin, when mail is unconfigured', () => {
        expect(mailProvider(config)).toBeNull();
        expect(buildPlugins(config).map((plugin) => plugin.name)).not.toContain(
            'mail'
        );
    });

    it('constructs the SMTP adapter and hands it the relay settings', () => {
        const provider = mailProvider(
            withMail({
                backend: 'smtp',
                appUrl: 'https://cms.example.com',
                from: 'no-reply@example.com',
                smtp: { host: 'smtp.example.com', port: 2525 }
            })
        );
        expect(provider?.id).toBe('smtp');
    });

    it('constructs the console adapter when that is what was named', () => {
        expect(
            mailProvider(
                withMail({
                    backend: 'console',
                    appUrl: 'https://cms.example.com',
                    from: 'no-reply@example.com'
                })
            )?.id
        ).toBe('console');
    });

    it('registers the plugin before users, so its migrations and port are there first', () => {
        const names = buildPlugins(
            withMail({
                backend: 'console',
                appUrl: 'https://cms.example.com',
                from: 'no-reply@example.com'
            })
        ).map((plugin) => plugin.name);

        // Migration order is what the position decides (the DI is global): the
        // plugin owns `mail_deliveries`, and `users` is what queues into it.
        expect(names).toContain('mail');
        expect(names.indexOf('mail')).toBeLessThan(names.indexOf('users'));
    });

    it('refuses SMTP with no relay settings rather than falling back to the log', () => {
        // The silent fall-through this prevents is the worst failure the
        // feature has: invitations that look sent and reach nobody.
        expect(() =>
            mailProvider(
                withMail({
                    backend: 'smtp',
                    appUrl: 'https://cms.example.com',
                    from: 'no-reply@example.com'
                })
            )
        ).toThrow(/SMTP_HOST/);
    });
});

/**
 * Which identity providers the shipped composition registers.
 *
 * Covered here for the same reason `copilotProviders` is: `buildPlugins` runs
 * above under the ambient environment, which configures nothing, so only the
 * empty path would ever execute — and the plugin object carries
 * `identityConfig`, not its providers, so a misconfigured registration would
 * have been green everywhere. Constructing the adapter costs nothing: discovery
 * is lazy, so no network call happens until a sign-in starts.
 */
describe('ssoProviders()', () => {
    /** The shipped config with an identity provider set substituted in. */
    const withSso = (
        ssoProviders: OrthaCmsConfig['plugins']['identity']['ssoProviders']
    ): OrthaCmsConfig => ({
        ...config,
        plugins: {
            ...config.plugins,
            identity: { ...config.plugins.identity, ssoProviders }
        }
    });

    const oidc = {
        name: 'keycloak',
        issuer: 'https://sso.example.com/realms/orthacms',
        clientId: 'orthacms',
        clientSecret: 'secret',
        label: 'Keycloak'
    };

    it('registers nothing when no provider is configured', () => {
        // The default install: the sign-in page shows the password form alone,
        // and `GET /api/auth/sso` answers `[]`.
        expect(ssoProviders(withSso({}))).toEqual([]);
    });

    it('registers a configured provider under its own name', () => {
        // The name is what the route and every `sso_identities` row refer to
        // the provider by, so registering under the wrong one orphans links
        // that already exist.
        const registered = ssoProviders(withSso({ oidc }));

        expect(registered.map((entry) => entry.name)).toEqual(['keycloak']);
        expect(registered[0].provider.descriptor()).toEqual({
            kind: 'oidc',
            label: 'Keycloak',
            callbackMethod: 'GET'
        });
    });

    it('does not pass the registration name through as adapter config', () => {
        // `name` is composition, not protocol. Leaving it on the object handed
        // to the adapter would be harmless today and exactly the kind of thing
        // a future strict-options check would reject at boot.
        const { label } = ssoProviders(
            withSso({ oidc: { ...oidc, label: undefined } })
        )[0].provider.descriptor();

        // With no label configured the adapter falls back to the issuer's host,
        // which it can only do if it received the issuer and not the name.
        expect(label).toBe('sso.example.com');
    });
});

/**
 * Which model backends the shipped composition registers, and in what order.
 *
 * Load-bearing since the copilot lost its `defaultProvider`: the **first**
 * registration serves any run that names none, and it is what the admin's model
 * picker opens on. Nothing else covers this — `buildPlugins` is called above
 * under the ambient environment, which has no keys, so only the empty path ever
 * ran; `server-e2e` registers its own two scripted providers and never reaches
 * this file; and the plugin object exposes `copilotConfig`, not the providers. A
 * `claude` entry handed the *ollama* settings would have been green everywhere.
 *
 * Constructing an adapter costs nothing here — `createAnthropicProvider` builds
 * its client lazily, so a placeholder key makes no network call and no SDK is
 * touched until a run streams.
 */
describe('copilotProviders()', () => {
    /** The shipped config with a copilot provider set substituted in. */
    const withProviders = (
        providers: OrthaCmsCopilotConfig['providers']
    ): OrthaCmsConfig => ({
        ...config,
        plugins: {
            ...config.plugins,
            copilot: { ...config.plugins.copilot, providers }
        }
    });

    const claude = {
        apiKey: 'sk-test',
        models: ['claude-opus-5', 'claude-haiku-4-5']
    };
    const ollama = {
        baseUrl: 'http://localhost:11434/v1',
        models: ['llama3.1'],
        apiKey: ''
    };

    it('registers nothing when nothing is configured [copilot:I-37]', () => {
        // The fresh-clone case. There is no scripted offline adapter in this
        // list any more — the fake provider is a private test fixture — so a
        // keyless deployment gets no copilot rather than one that answers every
        // question with a canned sentence. `COPILOT_ENABLED` is off by default,
        // so an empty list boots; turning the copilot on without configuring a
        // backend fails at construction.
        expect(copilotProviders(withProviders({})).map((p) => p.name)).toEqual(
            []
        );
    });

    it('registers exactly the configured backends, in preference order', () => {
        // Order is the whole assertion: the first entry serves a run that names
        // no provider, so a swap here silently reroutes every default run.
        expect(
            copilotProviders(withProviders({ claude })).map((p) => p.name)
        ).toEqual(['claude']);
        expect(
            copilotProviders(withProviders({ ollama })).map((p) => p.name)
        ).toEqual(['ollama']);
        expect(
            copilotProviders(withProviders({ claude, ollama })).map(
                (p) => p.name
            )
        ).toEqual(['claude', 'ollama']);
    });

    it('hands each adapter its own settings', () => {
        // The mistake this catches is a copy-paste one: two entries built from
        // the same config key read fine and route every run to one backend.
        const byName = new Map(
            copilotProviders(withProviders({ claude, ollama })).map((entry) => [
                entry.name,
                entry.provider
            ])
        );

        expect(byName.get('claude')?.models()).toEqual(claude.models);
        expect(byName.get('ollama')?.models()).toEqual(ollama.models);
    });

    it('offers the first registered model as the deployment default', () => {
        // `catalogue()[0]` is what a run naming no provider gets and what the
        // picker opens on, so this pins the pair the UI and the engine agree on.
        const [first] = copilotProviders(withProviders({ claude, ollama }));

        expect(first?.name).toBe('claude');
        expect(first?.provider.models()[0]).toBe('claude-opus-5');
    });
});
