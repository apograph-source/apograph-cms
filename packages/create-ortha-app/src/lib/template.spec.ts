import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
    COPILOT_PROVIDERS,
    MEDIA_PROVIDERS,
    type FeatureSelection
} from './features';
import { render, renderTemplate } from './template';
import type { TemplateValues } from './template';

const TEMPLATE = join(__dirname, '../../templates/default');

/** Base values, with the given feature ids enabled. */
function valuesWith(...ids: string[]): TemplateValues {
    const selection: FeatureSelection = { enabled: new Set(ids) };
    return {
        appName: 'my-cms',
        appTitle: 'My CMS',
        databaseUrl: 'postgresql://ortha:ortha@localhost:5432/my_cms',
        databaseName: 'my_cms',
        adminEmail: 'admin@example.com',
        adminPassword: 'hunter2',
        orthaVersion: '9.9.9',
        selection
    };
}

let target: string;

beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'create-ortha-'));
});

afterEach(() => rmSync(target, { recursive: true, force: true }));

/** Scaffolds with the given features enabled. */
function scaffold(...ids: string[]): void {
    renderTemplate(TEMPLATE, target, valuesWith(...ids));
}

/** Reads a rendered file out of the scaffolded app. */
function rendered(path: string): string {
    return readFileSync(join(target, path), 'utf8');
}

/** Every file in the template, as paths relative to its root. */
function templateFiles(dir = TEMPLATE): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory()
            ? templateFiles(path)
            : [relative(TEMPLATE, path)];
    });
}

/** Every file in the scaffolded app, as paths relative to its root. */
function generatedFiles(dir = target): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory()
            ? generatedFiles(path)
            : [relative(target, path)];
    });
}

/** The generated manifest. */
function manifest(): {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
} {
    return JSON.parse(rendered('package.json'));
}

describe('render', () => {
    it('substitutes every occurrence of a placeholder, not just the first', () => {
        expect(render('__APP_NAME__/__APP_NAME__', valuesWith())).toBe(
            'my-cms/my-cms'
        );
    });
});

describe('the scaffolded app, whatever the features', () => {
    beforeEach(() => scaffold('media-local', 'rest'));

    it('pins every @ortha dependency to this scaffolder’s version [create-ortha-app:I-03]', () => {
        const { dependencies, devDependencies } = manifest();
        const ortha = Object.entries({
            ...dependencies,
            ...devDependencies
        }).filter(([name]) => name.startsWith('@ortha/'));

        expect(ortha.length).toBeGreaterThan(0);
        for (const [, range] of ortha) expect(range).toBe('9.9.9');
    });

    /**
     * Releases are lockstep, and a partial upgrade can leave two copies of a
     * shared package in `node_modules` — two React context instances, and a UI
     * that silently stops talking to itself. Exact pins make an upgrade
     * all-or-nothing.
     */
    it('pins them exactly, with no caret', () => {
        for (const [name, range] of Object.entries(manifest().dependencies)) {
            if (!name.startsWith('@ortha/')) continue;
            expect(range.startsWith('^')).toBe(false);
        }
    });

    it('keeps the non-Ortha dependencies the template declares', () => {
        expect(manifest().dependencies).toHaveProperty('react');
        expect(manifest().devDependencies).toHaveProperty('vite');
    });

    it('sorts the dependency map', () => {
        const names = Object.keys(manifest().dependencies);

        expect(names).toEqual([...names].sort());
    });

    /**
     * npm silently refuses to publish a file named `.gitignore`, so the
     * template stores it as `_gitignore`. If this rename ever breaks, every
     * generated app starts by offering to commit `node_modules` — and nothing
     * about the tarball looks wrong.
     */
    it('restores the dotfiles npm will not publish [create-ortha-app:I-22]', () => {
        expect(readdirSync(target)).toContain('.gitignore');
        expect(readdirSync(target)).not.toContain('_gitignore');
        expect(rendered('.gitignore')).toContain('node_modules');
    });

    it('renames the .tmpl files onto their real names [create-ortha-app:I-22]', () => {
        const entries = readdirSync(target);

        expect(entries).toEqual(
            expect.arrayContaining(['package.json', '.env', 'README.md'])
        );
        expect(entries.filter((entry) => entry.endsWith('.tmpl'))).toEqual([]);
    });

    // ORT-149 — the generated `.env` used to carry two 256-bit secrets that
    // nothing read. Sessions and one-time tokens are opaque random values
    // checked against a row, so there is no key to place in a scaffolded app.
    it('scaffolds no signing secrets, because identity has none to sign with [create-ortha-app:I-17]', () => {
        const env = rendered('.env');

        expect(env).not.toContain('SESSION_SECRET');
        expect(env).not.toContain('TOKEN_SECRET');
    });

    /**
     * Every file, not a list of the interesting ones — the conditional-only
     * modules under `apps/server/config/` and the four generated specs are
     * exactly where an unclosed block or a forgotten placeholder would sit
     * unnoticed, since nobody opens them until something is already wrong.
     */
    it('leaves no placeholder or directive anywhere in the app [create-ortha-app:I-05]', () => {
        const files = generatedFiles();

        expect(files.length).toBeGreaterThan(30);
        for (const file of files) {
            expect(rendered(file)).not.toMatch(/__[A-Z_]+__/);
            expect(rendered(file)).not.toMatch(/ortha:(if|ifnot|end)/);
        }
    });

    it('renames every .tmpl file, at any depth [create-ortha-app:I-22]', () => {
        expect(
            generatedFiles().filter((file) => file.endsWith('.tmpl'))
        ).toEqual([]);
    });

    it('ships a runnable test setup', () => {
        for (const file of [
            'apps/server/jest.config.js',
            'apps/server/jest.setup.js',
            'apps/server/src/plugins.spec.ts',
            'apps/admin/vite.config.mts',
            'apps/admin/src/plugins.spec.ts',
            'apps/server-e2e/jest.config.js',
            'apps/server-e2e/src/api.spec.ts',
            'apps/server-e2e/src/global-setup.ts',
            'apps/server-e2e/src/jest.setup.ts',
            'apps/server-e2e/src/support/db.ts',
            'apps/server-e2e/src/support/test-app.ts',
            'apps/admin-e2e/playwright.config.ts',
            'apps/admin-e2e/src/auth.spec.ts',
            'apps/admin-e2e/src/support/seed.ts'
        ]) {
            expect(() => rendered(file)).not.toThrow();
        }

        const { scripts } = JSON.parse(rendered('package.json')) as {
            scripts: Record<string, string>;
        };
        expect(scripts).toMatchObject({
            test: expect.any(String),
            'test:server': expect.any(String),
            'test:admin': expect.any(String),
            e2e: expect.any(String),
            'e2e:server': expect.any(String),
            'e2e:admin': expect.any(String)
        });
    });

    /**
     * Otherwise `ortha build` compiles the tests into `dist/server` and ships
     * them — along with whatever fixtures they import.
     */
    it('keeps the unit specs out of the build [create-ortha-app:I-24]', () => {
        const tsconfig = JSON.parse(rendered('apps/server/tsconfig.json')) as {
            exclude?: string[];
        };

        expect(tsconfig.exclude).toContain('**/*.spec.ts');
    });

    /**
     * The generated app mirrors this repo's own `apps/` folder, so someone who
     * has read the Ortha source finds the same shape in their project — and so
     * the CLI's `LAYOUT` constants have one tree to describe.
     *
     * The server contributes **two** projects. `ortha build` compiles
     * `apps/server/tsconfig.json`, which excludes the specs so they are not
     * shipped in `dist/` — which also means nothing typechecks them, and an
     * editor opening one has no project to resolve `describe` in. The second
     * project is what covers them.
     */
    it('lays the four apps out like the monorepo [create-ortha-app:I-23]', () => {
        const root = JSON.parse(rendered('tsconfig.json')) as {
            references: { path: string }[];
        };

        expect(root.references.map((reference) => reference.path)).toEqual([
            './apps/server',
            './apps/server/tsconfig.spec.json',
            './apps/admin',
            './apps/server-e2e',
            './apps/admin-e2e'
        ]);
    });

    /**
     * The build config excludes the specs, so without a project of their own
     * they are typechecked by nothing and `describe` resolves to nothing —
     * `Cannot find name 'describe'` in the editor of a freshly generated app.
     */
    it('gives the server specs a project that knows about jest', () => {
        const spec = JSON.parse(rendered('apps/server/tsconfig.spec.json')) as {
            compilerOptions: { types: string[]; noEmit: boolean };
            include: string[];
        };

        expect(spec.compilerOptions.types).toContain('jest');
        expect(spec.include).toContain('src/**/*.spec.ts');
        // `ortha build` is the only thing that emits; this one only checks.
        expect(spec.compilerOptions.noEmit).toBe(true);
    });

    /**
     * `e2e/server` imports `src/server`, so it needs the server project's
     * compiler options — but it must not be emitted. Without a project of its
     * own it is simply never typechecked.
     */

    /**
     * The app is `"type": "commonjs"`, and Vite warns — and will eventually
     * fail — on ESM syntax in a config loaded as CommonJS.
     */
    it('names the Vite config .mts [create-ortha-app:I-26]', () => {
        expect(readdirSync(join(target, 'apps/admin'))).toContain(
            'vite.config.mts'
        );
    });

    /**
     * Tailwind excludes `node_modules` from content detection, so without this
     * line the admin renders completely unstyled — and nothing errors.
     *
     * It has to be a bare directory: a `@source` carrying a glob is still run
     * through the ignore rules (which exclude `node_modules`), so a pattern
     * like `@ortha/*\/dist/**\/*.js` matches zero files and the build is
     * silently unstyled. Only a literal directory becomes an explicit content
     * root. Hence the assertion on the exact, glob-free string.
     */
    it('points Tailwind at the installed packages [create-ortha-app:I-25]', () => {
        const styles = rendered('apps/admin/src/styles.css');
        expect(styles).toContain('@source "../../../node_modules/@ortha";');
        expect(styles).not.toMatch(/@source\s+"[^"]*node_modules[^"]*[*]/);
    });
});

describe('with nothing optional chosen', () => {
    beforeEach(() => scaffold('media-local', 'rest'));

    /**
     * The copilot ships with every app: its server half arrives transitively
     * whatever the manifest says, so declaring it costs nothing and leaving it
     * out bought only a missing chat panel. No **backend** comes with it — those
     * are opt-in — so a default app has the plugin installed and nothing
     * registered, with the kill switch off.
     */
    it('installs and registers the copilot', () => {
        const names = Object.keys(manifest().dependencies);

        expect(names).toEqual(
            expect.arrayContaining([
                '@ortha/copilot-server',
                '@ortha/copilot-admin'
            ])
        );
        expect(rendered('apps/server/src/plugins.ts')).toContain(
            'CopilotPlugin('
        );
        expect(rendered('apps/admin/src/plugins.ts')).toContain(
            'CopilotPlugin()'
        );
    });

    it('leaves it switched off until an operator opts in', () => {
        expect(rendered('.env')).toContain('COPILOT_ENABLED=false');
    });

    it('installs no model backend at all', () => {
        const names = Object.keys(manifest().dependencies);

        expect(names).not.toContain('@ortha/copilot-provider-anthropic');
        expect(names).not.toContain('@ortha/copilot-provider-openai');
        expect(names).not.toContain('@ortha/copilot-provider-fake');
        expect(rendered('.env')).not.toContain('ANTHROPIC_API_KEY');
    });

    /**
     * And registers none either. The scripted `fake` adapter is a private test
     * fixture of the CMS repo rather than a published package, so there is
     * nothing to fall back on — which is why the kill switch above has to stay
     * off until a backend is configured.
     */
    it('registers no provider', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).not.toContain('createFakeProvider');
        expect(plugins).not.toContain('createAnthropicProvider');
        expect(plugins).not.toContain('createOpenAiProvider');
    });

    it('mounts neither GraphQL nor MCP', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).not.toContain('ContentGraphqlPlugin');
        expect(plugins).not.toContain('McpPlugin');
    });

    it('still registers the core plugins', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        for (const name of [
            'DatabasePlugin',
            'IdentityPlugin',
            'WorkspacesPlugin',
            'ContentPlugin',
            'MediaServerPlugin'
        ]) {
            expect(plugins).toContain(name);
        }
    });
});

describe('with a copilot provider', () => {
    beforeEach(() => scaffold('media-local', 'rest', 'copilot-anthropic'));

    it('adds the chosen backend', () => {
        expect(Object.keys(manifest().dependencies)).toContain(
            '@ortha/copilot-provider-anthropic'
        );
    });

    it('does not install the provider that was not chosen', () => {
        expect(Object.keys(manifest().dependencies)).not.toContain(
            '@ortha/copilot-provider-openai'
        );
    });

    it('builds only the chosen provider in the registration helper', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).toContain('createAnthropicProvider');
        expect(plugins).not.toContain('createOpenAiProvider');
    });

    /**
     * And nothing else. There is no scripted stand-in appended after the chosen
     * backend any more — it was a private test fixture registered in every
     * generated app, and a keyless deployment answering every question with a
     * canned sentence is worse than having no copilot.
     */
    it('registers no offline stand-in alongside it [copilot:I-37]', () => {
        expect(rendered('apps/server/src/plugins.ts')).not.toContain(
            'createFakeProvider'
        );
    });

    it('writes the provider’s env keys', () => {
        expect(rendered('.env')).toContain('ANTHROPIC_API_KEY=');
        expect(rendered('.env')).not.toContain('COPILOT_OPENAI_BASE_URL');
    });

    it('keeps the copilot off until an operator opts in', () => {
        expect(rendered('.env')).toContain('COPILOT_ENABLED=false');
    });
});

describe('with both copilot providers', () => {
    beforeEach(() =>
        scaffold('media-local', 'rest', 'copilot-anthropic', 'copilot-openai')
    );

    it.each(COPILOT_PROVIDERS.map((provider) => provider.packages[0]))(
        'installs %s',
        (name) => {
            expect(Object.keys(manifest().dependencies)).toContain(name);
        }
    );

    it('registers both in the helper', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).toContain('createAnthropicProvider');
        expect(plugins).toContain('createOpenAiProvider');
    });
});

describe('with every protocol', () => {
    beforeEach(() => scaffold('media-local', 'rest', 'graphql', 'mcp'));

    it('installs and registers GraphQL', () => {
        expect(Object.keys(manifest().dependencies)).toContain(
            '@ortha/content-graphql'
        );
        expect(rendered('apps/server/src/plugins.ts')).toContain(
            'ContentGraphqlPlugin'
        );
    });

    it('installs and registers MCP', () => {
        expect(Object.keys(manifest().dependencies)).toContain(
            '@ortha/mcp-server'
        );
        expect(rendered('apps/server/src/plugins.ts')).toContain('McpPlugin');
    });

    it('keeps MCP off until an operator opts in', () => {
        expect(rendered('.env')).toContain('MCP_ENABLED=false');
    });

    /**
     * The GraphQL adapter takes the content plugin **by value**, so it can fail
     * boot on two content types that would collide as GraphQL names rather than
     * on the first request from a workspace granted both.
     */
    it('hands the content plugin to the GraphQL adapter', () => {
        const plugins = rendered('apps/server/src/plugins.ts');

        expect(plugins).toContain('const content = ContentPlugin(');
        expect(plugins).toContain('content,');
    });
});

/**
 * The properties that have to hold for *any* answer to the wizard, checked
 * against several answers rather than the one whose files happen to be open.
 */
describe('every combination', () => {
    const SELECTIONS: readonly (readonly [string, string[]])[] = [
        ['nothing optional', ['media-local', 'rest']],
        ['every protocol', ['media-local', 'rest', 'graphql', 'mcp']],
        ['single sign-on', ['media-local', 'rest', 'sso-oidc']],
        // One per identity provider, and then all three: they share the
        // `ssoProviders` key, the builder in `plugins.ts` and the second
        // argument to `IdentityPlugin`, so each is reached through the derived
        // `sso` flag rather than through its own marker.
        ['GitHub sign-in', ['media-local', 'rest', 'sso-github']],
        ['SAML sign-in', ['media-local', 'rest', 'sso-saml']],
        [
            'every identity provider',
            ['media-local', 'rest', 'sso-oidc', 'sso-github', 'sso-saml']
        ],
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
                'sso-saml'
            ]
        ]
    ];

    it.each(SELECTIONS)(
        'leaves no placeholder or directive behind — %s [create-ortha-app:I-05]',
        (_label, ids) => {
            scaffold(...ids);

            for (const file of generatedFiles()) {
                expect(rendered(file)).not.toMatch(/__[A-Z_]+__/);
                expect(rendered(file)).not.toMatch(/ortha:(if|ifnot|end)/);
            }
        }
    );

    /**
     * The two kill switches, and why they are not written the same way.
     *
     * The copilot is installed unconditionally, so its switch has to be in
     * every `.env` — an operator who decides to turn Ortha AI on should find
     * the line, off, rather than have to learn its name. MCP is a *chosen*
     * protocol: unchosen, the plugin is not installed and the endpoint does not
     * exist, so an `MCP_ENABLED` line would name a setting nothing reads.
     *
     * The dossier used to claim both were always written. `env.tmpl` puts
     * `MCP_ENABLED=false` inside the `ortha:if mcp` block, and the block is
     * right — this is the assertion that keeps the two from being conflated
     * again in either direction.
     */
    it.each(SELECTIONS)(
        'writes the copilot switch always and the MCP switch only when chosen — %s [create-ortha-app:I-15]',
        (_label, ids) => {
            scaffold(...ids);
            const env = rendered('.env');

            expect(env).toContain('COPILOT_ENABLED=false');
            // `toContain`/`not.toContain` on the same string across four
            // selections, two of which include `mcp` and two of which do not —
            // so neither half can pass by the fixture never exercising it.
            if (ids.includes('mcp')) {
                expect(env).toContain('MCP_ENABLED=false');
            } else {
                expect(env).not.toContain('MCP_ENABLED');
            }
        }
    );

    /**
     * Dropping lines from JSON is how you get a trailing comma and an app that
     * cannot be installed — blaming the template rather than the feature that
     * was switched off. So the manifest is the one file the conditional
     * processor never touches: its dependency set is assembled in
     * `features.ts` and re-sorted, and the template it starts from declares no
     * `@ortha` package at all.
     */
    it('assembles package.json in code rather than through blocks [create-ortha-app:I-06]', () => {
        const source = readFileSync(
            join(TEMPLATE, 'package.json.tmpl'),
            'utf8'
        );

        expect(source).not.toMatch(/ortha:(if|ifnot|end)/);
        expect(source).not.toContain('@ortha/');
    });

    it.each(SELECTIONS)(
        'still writes an installable manifest — %s [create-ortha-app:I-06]',
        (_label, ids) => {
            scaffold(...ids);

            const parsed = JSON.parse(rendered('package.json')) as {
                dependencies: Record<string, string>;
            };
            expect(Object.keys(parsed.dependencies)).toEqual(
                expect.arrayContaining(['@ortha/content-server', 'react'])
            );
        }
    );

    /**
     * The scaffolder's own version *is* the matching set, stamped in at render
     * time — so a release bumps every generated app with no template edit, and
     * `npx create-ortha-app@0.3.0` still generates a 0.3.0 app. A version
     * written down beside an `@ortha` name anywhere in here is a pin that
     * will be wrong by the next release and correct-looking forever.
     */
    it('writes no @ortha version down anywhere [create-ortha-app:I-04]', () => {
        const sources = [
            [
                'src/lib/features.ts',
                readFileSync(join(__dirname, 'features.ts'), 'utf8')
            ] as const,
            ...templateFiles().map(
                (file) =>
                    [file, readFileSync(join(TEMPLATE, file), 'utf8')] as const
            )
        ];

        for (const [name, source] of sources) {
            const pinned = source
                .split('\n')
                .filter(
                    (line) =>
                        line.includes('@ortha') && /\d+\.\d+\.\d+/.test(line)
                );

            expect([name, pinned]).toEqual([name, []]);
        }
    });

    it('lists no versions in features.ts at all [create-ortha-app:I-04]', () => {
        expect(
            readFileSync(join(__dirname, 'features.ts'), 'utf8')
        ).not.toMatch(/\d+\.\d+\.\d+/);
    });

    /**
     * Storage is a single choice, and it has to stay single all the way down:
     * one package installed, one provider constructed, one type on
     * `plugins.media.storage`. Two would not compile; none leaves
     * `mediaStorage()` undefined and the app dead at boot — and both are the
     * kind of mistake a stray `ortha:end` makes in a file nobody reads.
     */
    it.each(
        MEDIA_PROVIDERS.map(
            (provider) => [provider.id, provider.packages[0]] as const
        )
    )(
        'installs and constructs exactly one storage adapter — %s [create-ortha-app:I-11]',
        (id, pkg) => {
            scaffold(id, 'rest');

            const adapters = Object.keys(manifest().dependencies).filter(
                (name) => name.startsWith('@ortha/media-provider-')
            );
            expect(adapters).toEqual([pkg]);

            expect(
                rendered('apps/server/src/plugins.ts').match(
                    /provider: create\w+StorageProvider\(/g
                )
            ).toHaveLength(1);
            expect(
                rendered('apps/server/config/media-storage.ts').match(
                    /export function mediaStorage\(/g
                )
            ).toHaveLength(1);
            expect(
                rendered('apps/server/config/media.ts').match(
                    /^\s+storage: \w+;$/gm
                )
            ).toHaveLength(1);
        }
    );
});

describe('a file the template ships as data', () => {
    /**
     * Today's template is all text, so this is the one property with no fixture
     * in the template itself — hence a template built here, with a byte
     * sequence a substitution pass would eat. Running a favicon through a
     * string replace corrupts it in a way that only shows up in a browser.
     */
    it('is copied byte for byte, with no substitutions [create-ortha-app:I-30]', () => {
        const source = mkdtempSync(join(tmpdir(), 'create-ortha-src-'));
        const bytes = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from('__APP_NAME__'),
            Buffer.from([0x00, 0xff, 0xfe])
        ]);

        try {
            writeFileSync(join(source, 'favicon.png'), bytes);
            mkdirSync(join(source, 'apps'));
            writeFileSync(
                join(source, 'apps/index.html'),
                '<h1>__APP_TITLE__</h1>'
            );

            renderTemplate(source, target, valuesWith());

            expect(
                readFileSync(join(target, 'favicon.png')).equals(bytes)
            ).toBe(true);
            expect(rendered('apps/index.html')).toBe('<h1>My CMS</h1>');
        } finally {
            rmSync(source, { recursive: true, force: true });
        }
    });
});

/**
 * The template's `config/` reads the environment only through the shared
 * readers.
 *
 * `readEnv` is where "an empty value means the setting is absent" is decided,
 * once, so that a key `env.tmpl` ships blank leaves the setting unconfigured
 * rather than configured to `''`. A raw `process.env['X'] ?? default` skips
 * that decision and hands the blank line the win: `SSO_OIDC_NAME=` produced a
 * provider named `''` and a callback of `/api/auth/sso//callback`, silently.
 *
 * Checked against the template *source* rather than a rendering, because each
 * `ortha:if` block carries its own imports and only one survives — the source
 * is the one place every adapter's body is visible at once, so no combination
 * can hide a raw read behind a feature this fixture happens not to enable.
 *
 * A grep rather than an assertion on values: a raw read and a `readEnv` read
 * agree on every input except the blank one, which is exactly the input the
 * author of the next config module will not think to try.
 */
describe("the generated app's config modules", () => {
    const CONFIG = 'apps/server/config';

    const configFiles = templateFiles().filter(
        (file) => file.startsWith(CONFIG) && file.endsWith('.ts')
    );

    it.each(configFiles)('%s names no process.env of its own', (file) => {
        // A subscript, not the bare identifier: `ortha.config.ts`'s header
        // prose names `process.env` deliberately, and so may a comment here.
        expect(readFileSync(join(TEMPLATE, file), 'utf8')).not.toMatch(
            /process\.env\s*\[/
        );
    });

    it('finds the modules it is meant to be checking', () => {
        // Without this the suite above passes on a renamed folder or an
        // extension filter that stopped matching — the shape that lets a
        // structural test go quietly green over nothing.
        expect(configFiles.length).toBeGreaterThan(5);
    });
});
