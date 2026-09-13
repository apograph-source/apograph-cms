import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderTemplate, type TemplateValues } from './template';

/**
 * The generated README, checked against the app it describes.
 *
 * Nothing read this file before. `template.spec.ts` asserted that a
 * `README.md` came out of the rename, and that was the whole of it — so the
 * document drifted exactly where a document drifts: it kept naming
 * `src/server/plugins.ts` a layout change had moved to `apps/server/src/`, and
 * its `drizzle.config.ts` recipe pointed `out` two levels above the project
 * root, which a reader following it literally discovers as a folder full of
 * SQL outside their app.
 *
 * This is the first document a new user reads and the only one that tells them
 * how to add a content type, which is the first thing they will want to do. So
 * the assertions here are about the two claims a README can actually be wrong
 * about in a way a machine can see:
 *
 * - **every path it names is a path this app has** (or one it has just told the
 *   reader to create, and there are exactly three of those, each pinned on its
 *   own below), and
 * - **every command it says to run is a command that exists** — a script in the
 *   generated manifest, resolving to a subcommand the CLI dispatches.
 *
 * Both sides are *read* rather than restated: the paths come out of the
 * rendered README and are looked for in the rendered app, and the CLI's
 * commands and layout come out of `@apograph/cli`'s own source. A test that
 * only asserted the README contains some string would pass on a README that is
 * wrong about everything else.
 */

const TEMPLATE = join(__dirname, '../../templates/default');
const workspaceRoot = join(__dirname, '../../../..');

/** A source file of `@apograph/cli`, read through the workspace link. */
function cliSource(path: string): string {
    return readFileSync(
        join(
            realpathSync(join(workspaceRoot, 'node_modules/@apograph/cli')),
            path
        ),
        'utf8'
    );
}

/** A `LAYOUT` entry from the CLI — the app conventions it will not negotiate. */
function cliLayout(key: string): string {
    const source = cliSource('src/lib/project.ts');
    const match = new RegExp(`\\n    ${key}: '([^']+)'`).exec(source);

    if (!match) throw new Error(`LAYOUT has no ${key}`);

    return match[1] as string;
}

/** Every subcommand the `apograph` binary dispatches. */
function apographCommands(): string[] {
    return [...cliSource('src/cli.ts').matchAll(/\n {8}case '(\w+)':/g)].map(
        (match) => match[1] as string
    );
}

let target: string;

beforeAll(() => {
    target = mkdtempSync(join(tmpdir(), 'create-apograph-readme-'));
    const values: TemplateValues = {
        appName: 'my-cms',
        appTitle: 'My CMS',
        databaseUrl: 'postgresql://apograph:apograph@localhost:5432/my_cms',
        databaseName: 'my_cms',
        adminEmail: 'admin@example.com',
        adminPassword: 'hunter2',
        apographVersion: '9.9.9',
        // Every conditional block on, so the README's own `apograph:if` sections
        // are read too rather than rendered away.
        selection: {
            enabled: new Set([
                'media-local',
                'rest',
                'graphql',
                'mcp',
                'sso-oidc'
            ])
        }
    };
    renderTemplate(TEMPLATE, target, values);
});

afterAll(() => rmSync(target, { recursive: true, force: true }));

/** The rendered README. */
function readme(): string {
    return readFileSync(join(target, 'README.md'), 'utf8');
}

/** The generated manifest's scripts. */
function scripts(): Record<string, string> {
    return (
        JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        }
    ).scripts;
}

/* --------------------------------------------------------------- the paths */

/**
 * The three paths the README names that a generated app does not have, because
 * the README is telling the reader to create them. Each is pinned by a test of
 * its own further down — the list is an index of those, not an amnesty:
 *
 * - `apps/server/drizzle.config.ts` — must be the path `apograph generate`
 *   requires, or the instruction produces a file the command will not read.
 * - `apps/server/src/content/` — must sit inside the app's compiled tsc
 *   project, and is where step 1 says to put the content types.
 * - `migrations/` — must be where step 3's `out` resolves to *and* what the
 *   plugin's migrations descriptor names, or `generate` and `migrate` disagree
 *   about where the SQL lives.
 */
const CREATED_BY_FOLLOWING_THE_README = new Set([
    'apps/server/drizzle.config.ts',
    'apps/server/src/content/',
    'migrations/'
]);

/**
 * The app-relative paths a piece of inline code names.
 *
 * A URL path (`/api/v1/mcp`), a package (`@apograph/database`), and anything
 * with a space in it are not file paths and are left alone; a glob is trimmed
 * to the directory in front of its first `*`, since that is the part that has
 * to exist. `../../` is deliberately excluded — after this fix the README names
 * it only to say what *not* to write.
 */
function pathsNamedIn(markdown: string): string[] {
    const spans = [...markdown.matchAll(/`([^`\n]+)`/g)].map(
        (match) => match[1] as string
    );

    return [
        ...new Set(
            spans
                .filter((span) =>
                    /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.*-]+)*\/?$/.test(span)
                )
                .filter((span) => span.includes('/'))
                .filter((span) => !span.startsWith('.'))
                .map((span) => span.split('*')[0] as string)
        )
    ];
}

describe('the generated README’s paths', () => {
    it('names no path this app does not have', () => {
        const missing = pathsNamedIn(readme())
            .filter((path) => !CREATED_BY_FOLLOWING_THE_README.has(path))
            .filter((path) => !existsSync(join(target, path)));

        expect(missing).toEqual([]);
    });

    /**
     * The guard on the guard. If the extraction ever stops finding paths —
     * a regex tightened, the markdown reformatted — the test above passes on
     * an empty list and the README is unread again.
     */
    it('reads the paths out of the document rather than finding none', () => {
        const paths = pathsNamedIn(readme());

        expect(paths.length).toBeGreaterThan(10);
        expect(paths).toContain('apps/server/src/plugins.ts');
    });

    /**
     * The layout the README describes is a convention `@apograph/cli` enforces,
     * not a suggestion: `apograph generate` refuses outright when the app has no
     * `drizzle.config.ts` at exactly this path.
     */
    it('tells the reader to write the drizzle config where apograph generate looks for it', () => {
        expect(readme()).toContain(`\`${cliLayout('drizzleConfig')}\``);
    });
});

/* ------------------------------------------------- the drizzle instructions */

/** The `schema` / `out` of the drizzle config the README tells you to write. */
function drizzleRecipe(): { schema: string; out: string } {
    const source = readme();
    const schema = /\n\s+schema: '([^']+)'/.exec(source);
    const out = /\n\s+out: '([^']+)'/.exec(source);

    if (!schema || !out) {
        throw new Error('the README no longer shows a drizzle config to write');
    }

    return { schema: schema[1] as string, out: out[1] as string };
}

/**
 * Where the plugin's own migrations descriptor says the SQL lives, read from
 * the comment in the template's `plugins.ts` that the README's step 2 points
 * at. `generate` writes there and `migrate` reads from there, so the two have
 * to name one directory.
 */
function descriptorMigrationsDir(): string {
    const source = readFileSync(
        join(target, 'apps/server/src/plugins.ts'),
        'utf8'
    );
    const match = /dir: \(\) => join\(process\.cwd\(\), '([^']+)'\)/.exec(
        source
    );

    if (!match) {
        throw new Error(
            'plugins.ts no longer shows a root-relative migrations descriptor'
        );
    }

    return match[1] as string;
}

describe('the drizzle config the README tells you to write', () => {
    /**
     * The bug this exists for. drizzle-kit resolves `schema` and `out` from the
     * **working directory**, not from the config file, and `apograph generate`
     * runs it from the project root — so `out: '../../migrations'`, which reads
     * as "up out of apps/server", actually writes two levels *above the whole
     * app*, and `schema` is not found at all.
     */
    it('points out at the directory the plugin’s descriptor reads from', () => {
        const root = '/apps/my-cms';

        expect(resolve(root, drizzleRecipe().out)).toBe(
            resolve(root, descriptorMigrationsDir())
        );
    });

    it('points schema inside the folder step 1 says to write content types in', () => {
        const { schema } = drizzleRecipe();

        expect(schema).toContain('apps/server/src/content/');
        // The half a string check would miss: it has to be under a directory
        // the app really has, or `tsc` never sees the schema either.
        expect(existsSync(join(target, 'apps/server/src'))).toBe(true);
    });

    /** Neither path may climb out of the root drizzle-kit is started in. */
    it('resolves both paths inside the app, from the root the CLI runs in', () => {
        const root = '/apps/my-cms';
        const { schema, out } = drizzleRecipe();

        for (const path of [schema, out]) {
            expect(resolve(root, path).startsWith(`${root}/`)).toBe(true);
        }
    });
});

/* ------------------------------------------------------------ the commands */

/**
 * Every `npm run <script>` / `npm <script>` the README tells you to run.
 *
 * Read out of the code — inline spans and fenced blocks — rather than out of
 * the prose, which mentions npm as a program that does things ("what stops npm
 * nesting a second copy") and would otherwise contribute `nesting` as a script
 * nobody wrote.
 */
function npmCommandsIn(markdown: string): string[] {
    const code = [
        ...[...markdown.matchAll(/`([^`\n]+)`/g)].map(
            (match) => match[1] as string
        ),
        ...[...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(
            (match) => match[1] as string
        )
    ].join('\n');

    return [
        ...new Set(
            [...code.matchAll(/\bnpm (?:run )?([a-z][a-z0-9:-]*)/g)].map(
                (match) => match[1] as string
            )
        )
    ];
}

describe('the commands the generated README tells you to run', () => {
    it('cites only scripts this app’s package.json declares', () => {
        const declared = Object.keys(scripts());
        // npm's own subcommands, which are not scripts and never will be.
        const builtin = new Set(['install', 'ci', 'exec']);

        const unknown = npmCommandsIn(readme())
            .filter((name) => !builtin.has(name))
            .filter((name) => !declared.includes(name));

        expect(unknown).toEqual([]);
    });

    it('reads the commands out of the document rather than finding none', () => {
        expect(npmCommandsIn(readme())).toEqual(
            expect.arrayContaining(['dev', 'migrate', 'generate', 'test'])
        );
    });

    /**
     * And every script that reaches for the CLI names a subcommand the CLI
     * actually dispatches — otherwise the README is right about the script and
     * the script is wrong about the binary, which is `Unknown command` in front
     * of someone on their first five minutes.
     */
    it('runs the app through subcommands the apograph binary has', () => {
        const commands = apographCommands();
        expect(commands).toContain('migrate');

        const cited = new Set(npmCommandsIn(readme()));
        const wrong = Object.entries(scripts())
            .filter(([name]) => cited.has(name))
            .map(
                ([name, script]) =>
                    [name, /^apograph (\w+)/.exec(script)] as const
            )
            .filter(([, match]) => match !== null)
            .filter(
                ([, match]) =>
                    !commands.includes((match as RegExpExecArray)[1] as string)
            )
            .map(([name]) => name);

        expect(wrong).toEqual([]);
    });
});
