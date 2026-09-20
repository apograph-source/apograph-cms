import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { join, relative } from 'node:path';
import { applyConditionals } from './conditionals';
import {
    resolveDevPackages,
    resolveFlags,
    resolvePackages,
    type FeatureSelection
} from './features';

/** The values substituted into the template's placeholders. */
export interface TemplateValues {
    /** npm package name for the generated app. */
    appName: string;
    /** Human-readable name, used in the page title and the README. */
    appTitle: string;
    /** Postgres connection string. */
    databaseUrl: string;
    /** Database name, so `docker-compose.yml` creates the right one. */
    databaseName: string;
    /** Email of the admin provisioned on first boot. */
    adminEmail: string;
    /** Password for that admin. */
    adminPassword: string;
    /** The `@orthacms/*` version every dependency is pinned to. */
    orthaVersion: string;
    /** Which optional features the app was scaffolded with. */
    selection: FeatureSelection;
}

/**
 * Files renamed on their way out of the template.
 *
 * `.gitignore` is the one that matters: **npm refuses to publish a file by that
 * name**, silently, so a template carrying one ships without it and every
 * generated app starts by offering to commit `node_modules`. Storing it as
 * `_gitignore` is the standard workaround (create-vite and create-next-app do
 * the same). The `.tmpl` suffixes are a smaller thing — they keep a
 * `package.json` out of the workspace globs that would otherwise read the
 * template directory as a package of its own.
 */
const RENAMES: Readonly<Record<string, string>> = {
    _gitignore: '.gitignore',
    'env.tmpl': '.env',
    'package.json.tmpl': 'package.json',
    'README.md.tmpl': 'README.md'
};

/** Substitutes every `__PLACEHOLDER__` in `contents`. */
export function render(contents: string, values: TemplateValues): string {
    const replacements: Record<string, string> = {
        __APP_NAME__: values.appName,
        __APP_TITLE__: values.appTitle,
        __DATABASE_URL__: values.databaseUrl,
        __DATABASE_NAME__: values.databaseName,
        __ADMIN_EMAIL__: values.adminEmail,
        __ADMIN_PASSWORD__: values.adminPassword,
        __ORTHA_VERSION__: values.orthaVersion
    };

    return Object.entries(replacements).reduce(
        (text, [token, value]) => text.split(token).join(value),
        contents
    );
}

/**
 * Renders `package.json` for a selection.
 *
 * The dependency map is **rebuilt**, not patched: the template ships a manifest
 * with the non-Ortha dependencies and an empty `@ortha` set, and the chosen
 * packages are merged in and re-sorted here. Every `@orthacms/*` range is the
 * scaffolder's own version, exactly — no caret. Releases are lockstep, and a
 * partial upgrade can leave two copies of a shared package in `node_modules`,
 * which means two React context instances and an admin whose sidebar silently
 * stops talking to its provider.
 */
export function renderManifest(
    template: string,
    values: TemplateValues
): string {
    const manifest = JSON.parse(render(template, values)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        [key: string]: unknown;
    };
    const pin = (names: readonly string[]): Record<string, string> =>
        Object.fromEntries(names.map((name) => [name, values.orthaVersion]));

    manifest.dependencies = sortKeys({
        ...manifest.dependencies,
        ...pin(resolvePackages(values.selection))
    });
    manifest.devDependencies = sortKeys({
        ...manifest.devDependencies,
        ...pin(resolveDevPackages())
    });

    return `${JSON.stringify(manifest, null, 4)}\n`;
}

/** A copy of `record` with its keys in sorted order. */
function sortKeys(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
    );
}

/** File extensions rendered as text; everything else is copied byte for byte. */
const TEXT =
    /\.(ts|tsx|css|html|json|md|yml|yaml|tmpl|mjs|cjs|js)$|^_gitignore$/;

/** Every file under `dir`, recursively, as paths relative to it. */
function filesIn(dir: string, base = dir): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory()
            ? filesIn(path, base)
            : [relative(base, path)];
    });
}

/**
 * Copies the template into `target`: conditional blocks applied, placeholders
 * substituted, renames performed.
 *
 * Binary files are copied verbatim — a distinction worth keeping even though
 * today's template is all text, since running a favicon through a string
 * replace corrupts it in a way that only shows up in a browser.
 */
export function renderTemplate(
    templateDir: string,
    target: string,
    values: TemplateValues
): void {
    const flags = resolveFlags(values.selection);

    for (const file of filesIn(templateDir)) {
        const source = join(templateDir, file);
        const name = file.split('/').pop() ?? file;
        const renamed = RENAMES[name];
        const destination = join(
            target,
            renamed ? join(file, '..', renamed) : file
        );

        mkdirSync(join(destination, '..'), { recursive: true });

        if (!TEXT.test(name)) {
            cpSync(source, destination);
            continue;
        }

        const raw = readFileSync(source, 'utf8');

        // The manifest takes the other path: its dependency set is assembled,
        // not conditionally line-edited. See `renderManifest`.
        if (name === 'package.json.tmpl') {
            writeFileSync(destination, renderManifest(raw, values));
            continue;
        }

        const contents = applyConditionals(raw, flags, file);

        // A file that conditioned *itself* away is not written at all. This is
        // what lets one module per optional plugin live under `config/`: wrap
        // the whole of `config/mcp.ts` in `ortha:if mcp` and an app generated
        // without MCP has no such file, rather than an empty one whose only
        // job is to explain why it is empty. Guarded on the source having had
        // content, so a template file that is deliberately blank still ships.
        if (raw.trim() !== '' && contents.trim() === '') {
            continue;
        }

        writeFileSync(destination, render(contents, values));
    }
}

/** Whether `dir` exists and holds anything. */
export function isNonEmptyDirectory(dir: string): boolean {
    return (
        existsSync(dir) &&
        statSync(dir).isDirectory() &&
        readdirSync(dir).length > 0
    );
}
