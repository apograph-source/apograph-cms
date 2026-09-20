import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { renderTemplate, type TemplateValues } from './template';

/**
 * **`create-ortha-app:I-16`, the registration half.**
 *
 * "A copilot backend and an SSO provider register only when their settings are
 * present." The *config* half is pinned by `generated-config.spec.ts`, which
 * executes the rendered `config/` builders and watches an absent key produce no
 * settings object. The half nothing reached is the other end of the same rule:
 * `copilotProviders(config)` and `ssoProviders(config)` in the rendered
 * `apps/server/src/plugins.ts` are the code that turns absent settings into an
 * absent **entry**, and an inverted guard there — registering the provider the
 * config omitted — was caught by nothing.
 *
 * It is the half with the visible consequence. The first entry of
 * `copilotProviders` serves a run that names no provider, so a keyless backend
 * at the top of that list is the house default, and every first message fails
 * with an authentication error that reads as an Ortha bug. An unconfigured SSO
 * registration is a button on the sign-in page that can only fail.
 *
 * **Why it is executed this way.** Importing the rendered module normally pulls
 * in every plugin package and a vendor SDK, which is why the judgment file
 * recorded this as out of reach. It is not: the module is compiled and run with
 * a `require` that hands back stubs, so what executes is the **rendered source
 * text** — the real `if`, the real guard, the real list order — with only the
 * provider constructors replaced. Nothing heavy loads.
 */

const TEMPLATE = join(__dirname, '../../templates/default');

const values = (...ids: string[]): TemplateValues => ({
    appName: 'my-cms',
    appTitle: 'My CMS',
    databaseUrl: 'postgresql://ortha:ortha@localhost:5432/my_cms',
    databaseName: 'my_cms',
    adminEmail: 'admin@example.com',
    adminPassword: 'hunter2',
    orthaVersion: '9.9.9',
    selection: { enabled: new Set(ids) }
});

/** What a stubbed `@orthacms/*` module hands back for any named export. */
interface Stub {
    /** The export that was called — so a test can name which adapter ran. */
    factory: string;
    settings: unknown;
}

let target: string;

beforeEach(() => {
    target = mkdtempSync(join(__dirname, '../../.rendered-plugins-'));
});

afterEach(() => {
    rmSync(target, { recursive: true, force: true });
});

/**
 * Renders the app and evaluates its `plugins.ts` with every `@orthacms/*`
 * import stubbed.
 *
 * Each stubbed export is a function returning `{ factory, settings }`, so a
 * registration's `provider` says which adapter built it — that is what tells
 * "OpenAI was skipped" apart from "OpenAI was registered under Claude's name".
 */
function renderedPlugins(ids: string[]): Record<string, unknown> {
    renderTemplate(TEMPLATE, target, values(...ids));
    const source = readFileSync(
        join(target, 'apps/server/src/plugins.ts'),
        'utf8'
    );
    const { outputText } = transpileModule(source, {
        compilerOptions: {
            module: ModuleKind.CommonJS,
            target: ScriptTarget.ES2020
        }
    });

    const stubModule = new Proxy(
        {},
        {
            get: (_target, name: string) => (settings: unknown) =>
                ({ factory: name, settings }) as Stub
        }
    );
    const module = { exports: {} as Record<string, unknown> };

    runInNewContext(outputText, {
        exports: module.exports,
        module,
        require: () => stubModule,
        Object
    });

    return module.exports;
}

/** A config bag holding only what these two functions read. */
function config(options: {
    claude?: unknown;
    openai?: unknown;
    oidc?: unknown;
    github?: unknown;
    saml?: unknown;
}): unknown {
    const sso = {
        ...(options.oidc ? { oidc: options.oidc } : {}),
        ...(options.github ? { github: options.github } : {}),
        ...(options.saml ? { saml: options.saml } : {})
    };

    return {
        plugins: {
            copilot: {
                providers: {
                    claude: options.claude,
                    openai: options.openai
                }
            },
            identity: {
                ssoProviders: Object.keys(sso).length > 0 ? sso : undefined
            }
        }
    };
}

describe('copilotProviders in the rendered app', () => {
    const BOTH = ['media-local', 'rest', 'copilot-anthropic', 'copilot-openai'];

    /** The rendered `copilotProviders`, for an app with both backends chosen. */
    function providersFor(options: { claude?: unknown; openai?: unknown }) {
        const { copilotProviders } = renderedPlugins(BOTH) as {
            copilotProviders: (
                c: unknown
            ) => { name: string; provider: Stub }[];
        };
        return copilotProviders(config(options));
    }

    it('registers nothing when no key is set [create-ortha-app:I-16]', () => {
        // The state a fresh app is generated in. An empty list is what makes
        // `COPILOT_ENABLED` fail at boot rather than shipping a chat that
        // cannot answer.
        expect(providersFor({})).toEqual([]);
    });

    it('registers only the backend whose key is set [create-ortha-app:I-16]', () => {
        // The case an inverted guard would break silently: OpenAI configured,
        // Claude not, and a keyless `claude` entry sitting first in the list as
        // the house default.
        const registered = providersFor({
            openai: { apiKey: 'sk-test', model: 'gpt-5' }
        });

        expect(registered.map((entry) => entry.name)).toEqual(['openai']);
        // Built by the OpenAI adapter, from the settings that were present —
        // so this is the right factory under the right name, not the other
        // branch happening to answer.
        expect(registered[0].provider.factory).toBe('createOpenAiProvider');
        expect(registered[0].provider.settings).toEqual({
            apiKey: 'sk-test',
            model: 'gpt-5'
        });
    });

    it('registers both, Claude first, when both are set [create-ortha-app:I-16]', () => {
        // The control for the two cases above: the guards do let a configured
        // backend through, so an empty list is a decision rather than a
        // function that returns nothing. Order matters — the first entry is
        // what a run naming no provider gets.
        const registered = providersFor({
            claude: { apiKey: 'sk-ant' },
            openai: { apiKey: 'sk-test' }
        });

        expect(registered.map((entry) => entry.name)).toEqual([
            'claude',
            'openai'
        ]);
    });

    it('cannot register a backend the app was not generated with [create-ortha-app:I-16]', () => {
        // The template's own conditional half: with only Claude chosen, the
        // OpenAI branch is not in the rendered file at all, so a config that
        // somehow carried an `openai` key still registers nothing for it.
        const { copilotProviders } = renderedPlugins([
            'media-local',
            'rest',
            'copilot-anthropic'
        ]) as {
            copilotProviders: (c: unknown) => { name: string }[];
        };

        expect(
            copilotProviders(config({ openai: { apiKey: 'sk-test' } })).map(
                (entry) => entry.name
            )
        ).toEqual([]);
    });
});

describe('ssoProviders in the rendered app', () => {
    /** The rendered `ssoProviders`, for an app generated with OIDC. */
    function providersFor(oidc?: unknown) {
        const { ssoProviders } = renderedPlugins([
            'media-local',
            'rest',
            'sso-oidc'
        ]) as {
            ssoProviders: (c: unknown) => { name: string; provider: Stub }[];
        };
        return ssoProviders(config({ oidc }));
    }

    it('registers nothing when the provider is unconfigured [create-ortha-app:I-16]', () => {
        // `ortha.config.ts` omits the key when the issuer or client id is
        // missing; registering anyway puts a button on the sign-in page whose
        // only outcome is a failure.
        expect(providersFor(undefined)).toEqual([]);
    });

    /**
     * The three the wizard offers, each on its own.
     *
     * The picker offered all three from the start and only OIDC was wired: an
     * app generated with `--sso sso-github` installed the adapter package,
     * imported nothing, registered nothing, and had no key in `.env` to
     * configure — a choice whose whole effect was a line in `package.json`.
     * So this is per provider rather than per shape: it is exactly the case
     * where "the OIDC one works" said nothing about the other two.
     */
    describe.each([
        [
            'sso-oidc',
            'oidc',
            'createOidcProvider',
            { issuer: 'https://i.test', clientId: 'abc' }
        ],
        [
            'sso-github',
            'github',
            'createGithubProvider',
            { clientId: 'abc', clientSecret: 'shh' }
        ],
        [
            'sso-saml',
            'saml',
            'createSamlProvider',
            {
                entryPoint: 'https://idp.test/sso',
                idpCert: 'MIIC',
                issuer: 'urn:my-cms'
            }
        ]
    ])('%s', (_feature, key, factory, settings) => {
        /** The rendered `ssoProviders` for an app generated with all three. */
        function providers(configured: Record<string, unknown>) {
            const { ssoProviders } = renderedPlugins([
                'media-local',
                'rest',
                'sso-oidc',
                'sso-github',
                'sso-saml'
            ]) as {
                ssoProviders: (
                    c: unknown
                ) => { name: string; provider: Stub }[];
            };
            return ssoProviders(config(configured));
        }

        it('registers it under its own name, built by its own adapter [create-ortha-app:I-16]', () => {
            const registered = providers({
                [key]: { name: `acme-${key}`, ...settings }
            });

            expect(registered.map((entry) => entry.name)).toEqual([
                `acme-${key}`
            ]);
            expect(registered[0].provider.factory).toBe(factory);
            // The name is the registration's, not the adapter's settings.
            expect(registered[0].provider.settings).toEqual(settings);
        });

        it('is absent when this provider alone is unconfigured [create-ortha-app:I-16]', () => {
            // The other two are configured, so an empty list would prove
            // nothing: what this shows is that the guard is per provider.
            const others = {
                oidc: { name: 'o', issuer: 'https://i.test', clientId: 'a' },
                github: { name: 'g', clientId: 'a', clientSecret: 's' },
                saml: {
                    name: 's',
                    entryPoint: 'https://idp.test/sso',
                    idpCert: 'MIIC',
                    issuer: 'urn:my-cms'
                }
            } as Record<string, unknown>;
            delete others[key];

            expect(providers(others).map((entry) => entry.name)).not.toContain(
                `acme-${key}`
            );
            expect(providers(others)).toHaveLength(2);
        });
    });

    it('registers it under its own name once configured [create-ortha-app:I-16]', () => {
        // The control, and the name is load-bearing on its own: it is what
        // `/api/auth/sso/<name>/start` and every `sso_identities` row refer to.
        const registered = providersFor({
            name: 'acme',
            issuer: 'https://issuer.example',
            clientId: 'abc'
        });

        expect(registered.map((entry) => entry.name)).toEqual(['acme']);
        expect(registered[0].provider.factory).toBe('createOidcProvider');
        // The name is the registration's, not the adapter's settings — passing
        // it through would make it a second source of truth for the callback
        // URL the provider was told to use.
        expect(registered[0].provider.settings).toEqual({
            issuer: 'https://issuer.example',
            clientId: 'abc'
        });
    });
});
