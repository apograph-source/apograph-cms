import {
    existsSync,
    readFileSync,
    readdirSync,
    mkdtempSync,
    realpathSync,
    rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTemplate, type TemplateValues } from './template';
import { CORE_PACKAGES } from './features';

/**
 * What the generated app is composed of — asserted from the template, before
 * anyone has scaffolded anything.
 *
 * The generated app ships specs of its own that assert exactly this
 * (`apps/{server,admin}/src/plugins.spec.ts`), and **they never run here**: the
 * scaffolder's `testMatch` is `src/**` and the template is data. So the one
 * thing those specs cannot check is whether *they themselves* still describe
 * the app — and that is the failure this file exists for. A plugin added to
 * `plugins.ts` and not to `EXPECTED_PLUGINS` makes `npm test` red in every app
 * generated from that day on, in the first minute of a new user's first
 * project, and nothing upstream notices.
 *
 * Both sides are read rather than re-stated. The registered list comes from the
 * rendered `plugins.ts`; each plugin's *name* comes from the package that
 * defines the factory — so this cannot drift into agreeing with a template that
 * is wrong. What it cannot see is a factory that decides its own name from its
 * arguments; none of them does.
 */

const TEMPLATE = join(__dirname, '../../templates/default');
const workspaceRoot = join(__dirname, '../../../..');

/** Base values, with the given feature ids enabled. */
function valuesWith(...ids: string[]): TemplateValues {
    return {
        appName: 'my-cms',
        appTitle: 'My CMS',
        databaseUrl: 'postgresql://orthacms:orthacms@localhost:5432/my_cms',
        databaseName: 'my_cms',
        adminEmail: 'admin@example.com',
        adminPassword: 'hunter2',
        orthacmsVersion: '9.9.9',
        selection: { enabled: new Set(ids) }
    };
}

let target: string;

beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'create-orthacms-'));
});

afterEach(() => rmSync(target, { recursive: true, force: true }));

/** Scaffolds with the given features enabled and reads a file back. */
function scaffold(...ids: string[]): (path: string) => string {
    renderTemplate(TEMPLATE, target, valuesWith(...ids));
    return (path: string) => readFileSync(join(target, path), 'utf8');
}

/* ------------------------------------------------------- reading the template */

/** The body of `buildPlugins`'s returned array. */
function pluginArray(source: string): string {
    const start = source.indexOf('export function buildPlugins');
    const open = source.indexOf('return [', start);
    const close = source.indexOf('\n    ];', open);

    expect(start).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);

    return source.slice(open, close);
}

/**
 * The factories registered in `buildPlugins`, in order.
 *
 * Entries sit at exactly one indent level inside the array, so a nested option
 * (`provider:`, `config:`) and a closing `}),` are both skipped. A bare
 * identifier — `content,`, held in a variable because the GraphQL adapter takes
 * the plugin itself — is resolved back to the factory that built it.
 */
function registeredFactories(source: string): string[] {
    const aliases = new Map<string, string>();
    for (const [, alias, factory] of source.matchAll(
        /const\s+(\w+)\s*=\s*(\w+Plugin)\(/g
    )) {
        aliases.set(alias as string, factory as string);
    }

    const names: string[] = [];
    for (const line of pluginArray(source).split('\n')) {
        const match = /^ {8}([A-Za-z_$][\w$]*)\s*[(,]/.exec(line);
        if (!match) continue;
        const token = match[1] as string;
        names.push(aliases.get(token) ?? token);
    }

    return names;
}

/** Which `@orthacms/*` package each imported factory came from. */
function importedFrom(source: string): Map<string, string> {
    const owners = new Map<string, string>();
    for (const [, specifiers, pkg] of source.matchAll(
        /^import\s+\{([\s\S]*?)\}\s+from\s+'(@orthacms\/[^']+)'/gm
    )) {
        for (const specifier of (specifiers as string).split(',')) {
            const name = specifier.trim();
            if (!name || name.startsWith('type ')) continue;
            owners.set(name, pkg as string);
        }
    }
    return owners;
}

/** Every source file of a workspace package. */
function sourcesOf(pkg: string): string[] {
    const root = join(
        realpathSync(join(workspaceRoot, 'node_modules', pkg)),
        'src'
    );
    const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
                ? walk(join(dir, entry.name))
                : /\.tsx?$/.test(entry.name)
                  ? [join(dir, entry.name)]
                  : []
        );
    return walk(root);
}

/**
 * The `name` a plugin factory gives itself, read from the package that defines
 * it — the same string the generated app's spec compares against at runtime.
 */
function pluginNameOf(factory: string, pkg: string): string {
    for (const file of sourcesOf(pkg)) {
        const source = readFileSync(file, 'utf8');
        const at = source.indexOf(`export function ${factory}(`);
        if (at === -1) continue;
        const match = /\n\s+name: '([^']+)'/.exec(source.slice(at));
        if (match) return match[1] as string;
    }
    throw new Error(`${factory} is not defined in ${pkg}`);
}

/** The plugin names a rendered `plugins.ts` registers, in order. */
function registeredNames(source: string): string[] {
    const owners = importedFrom(source);
    return registeredFactories(source).map((factory) => {
        const pkg = owners.get(factory);
        if (!pkg) throw new Error(`${factory} is imported from nowhere`);
        return pluginNameOf(factory, pkg);
    });
}

/** The list a rendered `plugins.spec.ts` expects. */
function expectedNames(source: string): string[] {
    const open = source.indexOf('const EXPECTED_PLUGINS = [');
    const close = source.indexOf('\n];', open);

    expect(open).toBeGreaterThan(-1);

    return (
        source
            .slice(open, close)
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n')
            .match(/'([a-z0-9-]+)'/g) ?? []
    ).map((quoted) => quoted.slice(1, -1));
}

/* ------------------------------------------------------------------- the tests */

/**
 * Every combination the two conditional plugins produce. The generated app's
 * expected list carries `orthacms:if` blocks of its own, so it has to stay right
 * for each of them rather than for the one the author happened to render.
 */
const COMBINATIONS: readonly (readonly string[])[] = [
    [],
    ['graphql'],
    ['mcp'],
    ['graphql', 'mcp']
];

describe('the generated app’s server composition', () => {
    it.each(
        COMBINATIONS.map(
            (ids) => [ids.join(', ') || 'nothing optional', ids] as const
        )
    )(
        'ships a plugins.spec.ts that expects what plugins.ts registers — %s [create-orthacms-app:I-29]',
        (_label, ids) => {
            const rendered = scaffold('media-local', 'rest', ...ids);

            expect(
                expectedNames(rendered('apps/server/src/plugins.spec.ts'))
            ).toEqual(registeredNames(rendered('apps/server/src/plugins.ts')));
        }
    );

    /**
     * The order is migration order: migrations are applied by walking this
     * array with no transaction spanning plugins, so a plugin whose tables
     * reference another's must come after it. `workspaces.memberships`
     * FK-references identity's `users` — reversed, a *fresh* migrate fails
     * while an already-migrated database is perfectly happy, so the mistake
     * ships and bites the next clean install rather than its author.
     */
    it('opens the database first and migrates identity before workspaces [create-orthacms-app:I-27]', () => {
        const names = registeredNames(
            scaffold('media-local', 'rest')('apps/server/src/plugins.ts')
        );

        expect(names[0]).toBe('database');
        expect(names.indexOf('identity')).toBeLessThan(
            names.indexOf('workspaces')
        );
    });

    /** It serves whatever the plugins above it contributed, so it comes last. */
    it('registers MCP last, where present [create-orthacms-app:I-27]', () => {
        const withMcp = registeredNames(
            scaffold(
                'media-local',
                'rest',
                'graphql',
                'mcp'
            )('apps/server/src/plugins.ts')
        );

        expect(withMcp.at(-1)).toBe('mcp');
        expect(withMcp).toContain('content-graphql');
    });
});

describe('the generated app’s admin composition', () => {
    it('ships a plugins.spec.ts that expects what plugins.ts registers [create-orthacms-app:I-29]', () => {
        const rendered = scaffold('media-local', 'rest');

        expect(
            expectedNames(rendered('apps/admin/src/plugins.spec.ts'))
        ).toEqual(registeredNames(rendered('apps/admin/src/plugins.ts')));
    });

    /**
     * The host mounts the **first** layout it finds, and the shell's is what
     * composes identity's auth gate — so a second contributor placed ahead of
     * it renders every private route *ungated*, which looks like a styling
     * accident rather than an authorization hole. Identity is first for the
     * opposite reason: sign-in and accept-invite must render outside that gate.
     *
     * The "exactly one" half is read from the packages themselves, not from the
     * template: a plugin that grows a `layout` in some later release fails here
     * without anyone having touched the scaffolder.
     */
    it('lets only the shell supply a layout, and puts identity first [create-orthacms-app:I-28]', () => {
        const source = scaffold(
            'media-local',
            'rest'
        )('apps/admin/src/plugins.ts');
        const owners = importedFrom(source);
        const factories = registeredFactories(source);

        const layouts = factories.filter((factory) =>
            sourcesOf(owners.get(factory) as string).some((file) => {
                const text = readFileSync(file, 'utf8');
                const at = text.indexOf(`export function ${factory}(`);
                return at !== -1 && /\n[ \t]+layout:/.test(text.slice(at));
            })
        );

        expect(layouts).toEqual(['ShellPlugin']);
        expect(registeredNames(source)[0]).toBe('identity');
    });
});

/**
 * The gap between "installed" and "mounted".
 *
 * `features.spec.ts` proves every published package is *classified*, which puts
 * it in the generated `package.json`. Nothing proved the second half: that a
 * package which **is a plugin** is also registered in `buildPlugins`. The two
 * are independent, and the failure is silent in both directions — the app
 * installs cleanly, `npm test` stays green, and the feature is simply not
 * there. There is no route, no nav row, and no error saying why.
 *
 * It is not hypothetical. `v0.4.0`–`v0.4.3` shipped `transfer-*` and
 * `segments-*` as dependencies of every generated app while registering
 * neither, and `webhooks-*` was classified a release before it was mounted.
 * Users got the packages in `node_modules` and no export/import dialogs, no
 * audience directory and no webhooks page. It was found by hand and fixed by
 * hand; every existing guard was green throughout.
 *
 * The plugin-ness of a package is read from the package, not listed here — an
 * exported factory whose return type is a `…Plugin` (or the `…PluginType` /
 * `…PluginDefinition` alias some packages use). So a library that grows a
 * plugin factory in a later release fails this without anyone having touched
 * the scaffolder, which is the whole point: adding a plugin to the workspace
 * should force a decision about whether a new app mounts it.
 *
 * Only `CORE_PACKAGES` is checked. A feature's packages are conditional by
 * design — an unpicked media adapter or an `orthacms:if`-guarded protocol is
 * *meant* to be absent — and `conditionals.spec.ts` covers those.
 */
describe('every core plugin package is actually mounted', () => {
    /**
     * The plugin factories a package exports, by name.
     *
     * Empty for a library — `utils-admin`, `design-system`, the `*-domain`
     * kernels, `tools-server` — which is how a package opts out of this guard
     * without being listed anywhere as an exception.
     */
    function pluginFactoriesOf(pkg: string): string[] {
        const factories: string[] = [];

        for (const file of sourcesOf(pkg)) {
            for (const [, factory] of readFileSync(file, 'utf8').matchAll(
                /export function (\w+)\s*\([^)]*\)\s*:\s*\w*Plugin(?:Type|Definition)?\s*\{/g
            )) {
                factories.push(factory as string);
            }
        }

        return factories;
    }

    const pluginPackages = CORE_PACKAGES.filter(
        (pkg) => pluginFactoriesOf(pkg).length > 0
    );

    /**
     * A sanity check on the detector itself. If the return-type convention ever
     * changes, `pluginFactoriesOf` quietly finds nothing and every assertion
     * below passes vacuously — the guard would still be green while guarding
     * nothing, which is worse than not having it.
     */
    it('recognises the core packages that define plugins', () => {
        expect(pluginPackages.length).toBeGreaterThan(20);
        expect(pluginPackages).toContain('@orthacms/webhooks-server');
        expect(pluginPackages).toContain('@orthacms/webhooks-admin');
        expect(pluginPackages).not.toContain('@orthacms/utils-admin');
        expect(pluginPackages).not.toContain('@orthacms/webhooks-domain');
    });

    // covers: create-orthacms-app:I-33
    it.each(pluginPackages)('%s is registered in buildPlugins', (pkg) => {
        const rendered = scaffold('media-local', 'rest');
        const composition = [
            rendered('apps/server/src/plugins.ts'),
            rendered('apps/admin/src/plugins.ts')
        ];
        const factories = pluginFactoriesOf(pkg);

        // If this fails you added a plugin package to `CORE_PACKAGES` without
        // mounting it. Import one of its factories in the matching
        // `templates/default/apps/{server,admin}/src/plugins.ts`, add it to the
        // returned array, and add its plugin `name` to that app's
        // `EXPECTED_PLUGINS`. Installing it is not shipping it.
        const mounted = composition.some((source) => {
            const owners = importedFrom(source);
            return registeredFactories(source).some(
                (factory) =>
                    factories.includes(factory) && owners.get(factory) === pkg
            );
        });

        expect(mounted).toBe(true);
    });
});

/**
 * Mail, which is conditional **twice**: on what the wizard was asked for, and
 * on what the operator later put in `.env`.
 *
 * The second condition is why it cannot ride the `EXPECTED_PLUGINS` comparison
 * above — `buildPlugins` registers it only when `MAIL_PROVIDER` names a
 * backend, so neither side of that comparison can name it and nothing else
 * would notice the whole feature going missing from the template. This is that
 * notice: scaffolding with a backend has to produce the import, the
 * registration and the config module, and scaffolding without one has to
 * produce none of them — an app that installs a relay client and never
 * constructs it is the `transfer-*` mistake with a queue attached.
 */
describe('the mail plugin', () => {
    it('is composed when a backend was chosen [create-orthacms-app:I-35]', () => {
        const rendered = scaffold('media-local', 'rest', 'mail-smtp');
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).toContain("from '@orthacms/mail-server'");
        expect(plugins).toContain('MailServerPlugin({');
        expect(plugins).toContain('createSmtpMailProvider(mail.smtp)');
        // Before `users`, whose invite, resend and reset queue through it.
        expect(plugins.indexOf('...mailPlugin(config)')).toBeLessThan(
            plugins.indexOf('UsersPlugin()')
        );
        expect(rendered('apps/server/config/mail.ts')).toContain(
            'MAIL_PROVIDER'
        );
    });

    it('leaves no husk in an app that sends nothing [create-orthacms-app:I-35]', () => {
        renderTemplate(TEMPLATE, target, valuesWith('media-local', 'rest'));
        const plugins = readFileSync(
            join(target, 'apps/server/src/plugins.ts'),
            'utf8'
        );

        expect(plugins).not.toContain('@orthacms/mail-server');
        expect(plugins).not.toContain('mailPlugin');
        // The file conditioned itself away entirely, rather than shipping an
        // empty module explaining why it is empty.
        expect(existsSync(join(target, 'apps/server/config/mail.ts'))).toBe(
            false
        );
    });
});

/**
 * A `.env` key nothing reads.
 *
 * The generated `.env` is documentation as much as configuration — it is where
 * an operator learns which knobs exist, and each key ships with a paragraph
 * saying what turning it does. So a key nobody reads is worse than a missing
 * one: the operator sets it, restarts, and gets the default anyway, with the
 * file in front of them promising otherwise. Nothing errors, because an unread
 * environment variable is not an error.
 *
 * That is not hypothetical either. The template shipped five `WEBHOOKS_*` keys
 * — including `WEBHOOKS_ALLOW_PRIVATE_NETWORKS`, which is what a self-hosted
 * install has to turn on to reach an in-cluster receiver — while
 * `WebhooksPlugin()` was called with no config at all and no `config/webhooks.ts`
 * existed to read them. Every one was inert.
 *
 * Read against the **whole rendered app**, not just `config/`: `ADMIN_PORT`
 * belongs to the Vite config, `DATABASE_URL` to two places, and the e2e setup
 * has keys of its own. Every combination is rendered, because a key inside an
 * `orthacms:if` block must be read by something that survives the same block —
 * shipping `GRAPHQL_MAX_DEPTH` to an app with no GraphQL would be the same bug
 * with a conditional in front of it.
 */
describe('the generated .env has no key nothing reads', () => {
    /** Every `KEY=` declared in a rendered `.env`. */
    function declaredKeys(env: string): string[] {
        return [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
            (match) => match[1] as string
        );
    }

    /** Every rendered file except the `.env` itself. */
    function renderedSources(): string {
        const walk = (dir: string): string[] =>
            readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
                entry.isDirectory()
                    ? walk(join(dir, entry.name))
                    : entry.name === '.env'
                      ? []
                      : [join(dir, entry.name)]
            );

        return walk(target)
            .map((file) => readFileSync(file, 'utf8'))
            .join('\n');
    }

    // covers: create-orthacms-app:I-34
    it.each([
        ['nothing optional', ['media-local', 'rest']],
        ['every protocol', ['media-local', 'rest', 'graphql', 'mcp']],
        ['mail', ['media-local', 'rest', 'mail-smtp']],
        [
            'everything at once',
            [
                'media-s3',
                'rest',
                'graphql',
                'mcp',
                'copilot-anthropic',
                'copilot-openai',
                'sso-oidc',
                'sso-github',
                'sso-saml',
                'mail-smtp'
            ]
        ]
    ])('%s', (_label, ids) => {
        const rendered = scaffold(...(ids as string[]));
        const sources = renderedSources();

        // If this fails, a key in `env.tmpl` is read by nothing the app ships.
        // Either give it a reader — usually a line in the matching
        // `apps/server/config/` module — or delete it. Documenting a setting
        // that does nothing is the worse of the two.
        const inert = declaredKeys(rendered('.env')).filter(
            (key) => !sources.includes(key)
        );

        expect(inert).toEqual([]);
    });
});
