/**
 * Stages one workspace package for `npm publish`.
 *
 * In the workspace every package resolves **from source** — `exports` points
 * at `./src/index.ts` and `tsconfig.base.json` sets the
 * `@ortha/source` condition (see AGENTS.md, "How packages resolve").
 * That is a workspace concern, and a published tarball cannot rely on it: a
 * consumer has no such condition and no way to compile our TypeScript.
 *
 * So nothing about the checked-in manifests changes. Instead `pack` builds a
 * throwaway package root under `dist/pack/<projectRoot>/` that holds what
 * the registry should see:
 *
 *     package.json     rewritten — exports point at ./dist, workspace
 *                      dependencies pinned to the released version, `bin`
 *                      remapped the same way `main` is
 *     dist/            the tsc output (JS + .d.ts), plus any non-TS asset
 *                      that lived beside the source (e.g. styles.css)
 *     migrations/      verbatim, for plugins that ship Drizzle migrations
 *     templates/       verbatim, for the scaffolder's app templates
 *     README.md LICENSE
 *
 * `nx release publish` points its `packageRoot` here (the target is inferred
 * by `@ortha/nx`), so the tarball is exactly this directory.
 *
 * It has to live at the workspace root rather than beside the package: the
 * root `workspaces` globs cover `packages/*`, so a staging directory inside
 * a flat package is itself read as a workspace, and npm refuses to run at
 * all against two workspaces with the same name.
 *
 * Usage: node tools/release/pack.mjs <projectRoot>
 */

import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import ts from 'typescript';

const workspaceRoot = process.cwd();
const projectRoot = process.argv[2];

if (!projectRoot) {
    fail('usage: node tools/release/pack.mjs <projectRoot>');
}

const projectDir = join(workspaceRoot, projectRoot);
const manifestPath = join(projectDir, 'package.json');

if (!existsSync(manifestPath)) {
    fail(`no package.json at ${projectRoot}`);
}

const pkg = readJson(manifestPath);
const rootPkg = readJson(join(workspaceRoot, 'package.json'));
const stagingDir = join(workspaceRoot, 'dist', 'pack', projectRoot);
const buildDir = join(projectDir, 'dist');

const repoUrl =
    rootPkg.repository?.url ??
    'git+https://github.com/ortha-source/ortha-cms.git';
const repoWeb = repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
/*
 * The project's website, which is what npm means by `homepage` — the page a
 * reader lands on from a package listing. `repository` and `bugs` still point
 * at GitHub, so a tarball says where the source is and where a bug goes
 * without conflating either with where the product is explained.
 */
const website = rootPkg.homepage ?? 'https://ortha.com';

if (!existsSync(buildDir)) {
    fail(`${pkg.name} has no dist/ — run \`nx build ${pkg.name}\` first`);
}

// A private package is not a distributable, and the staged manifest is built
// field by field below — it never carries `private` forward. So `dist/pack` is
// the point at which that fact is lost: everything downstream reads the staged
// manifest, sees no flag, and treats the package as publishable.
// `packages/nx` already withholds the `pack` target from a private package, but
// this script is also run by hand, and a staged directory outlives the policy
// that produced it. Refuse here too, where the flag is still readable.
if (pkg.private) {
    fail(
        `${pkg.name} is marked private and must not be staged for publication.\n` +
            '        If it is meant to ship, drop `"private": true` from its package.json;\n' +
            '        `packages/nx` infers the pack target from that flag.'
    );
}

/* ------------------------------------------------------------------ files */

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// The compiler output. `.tsbuildinfo` is incremental-build state, not a file
// consumers have any use for.
cpSync(buildDir, join(stagingDir, 'dist'), {
    recursive: true,
    filter: (src) => !src.endsWith('.tsbuildinfo')
});

// tsc only emits what it compiles, so anything non-TS that sits beside the
// source (`src/styles.css`) has to be carried over by hand, at the same
// relative path the compiled files landed on.
for (const asset of assetsIn(join(projectDir, 'src'))) {
    const target = join(
        stagingDir,
        'dist',
        relative(join(projectDir, 'src'), asset)
    );
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(asset, target);
}

// Migrations are resolved at runtime as `join(__dirname, '../../../migrations')`
// from `<pkg>/dist/lib/utils/`, which is the same depth the source used — so
// they only need to keep sitting at the package root.
const migrations = join(projectDir, 'migrations');
if (existsSync(migrations)) {
    cpSync(migrations, join(stagingDir, 'migrations'), { recursive: true });
}

// Scaffolding templates (`create-ortha-app`). They are data, not source —
// deliberately outside `src/` so `tsc --build` never tries to compile an
// app-shaped file against this workspace's resolve-from-source setup — so
// nothing else in this script would carry them over.
const templates = join(projectDir, 'templates');
if (existsSync(templates)) {
    cpSync(templates, join(stagingDir, 'templates'), { recursive: true });
}

cpSync(join(workspaceRoot, 'LICENSE'), join(stagingDir, 'LICENSE'));

const readme = join(projectDir, 'README.md');
if (existsSync(readme)) {
    cpSync(readme, join(stagingDir, 'README.md'));
} else {
    writeFileSync(join(stagingDir, 'README.md'), stubReadme(pkg.name));
}

/* --------------------------------------------------------------- manifest */

/*
 * The licence is stated on the package itself, never inherited. Every
 * package publishes under the workspace's licence, and a manifest that
 * omits the field or says something else is either a mistake or a
 * decision — both are worth stopping a release for, because a tarball's
 * licence is the one field a consumer's compliance scanner reads and the
 * one that cannot be corrected after publication.
 */
if (!pkg.license) {
    fail(
        `${pkg.name} has no "license" field; every published package must state one`
    );
}
if (pkg.license !== rootPkg.license) {
    fail(
        `${pkg.name} is licensed "${pkg.license}" but the workspace is "${rootPkg.license}".\n` +
            '        A package under a different licence is a deliberate decision — record it\n' +
            '        in an ADR and lift this check for that package explicitly.'
    );
}

const staged = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? `${pkg.name} — part of Ortha CMS.`,
    license: pkg.license,
    homepage: website,
    repository: { type: 'git', url: repoUrl, directory: projectRoot },
    bugs: { url: `${repoWeb}/issues` },
    main: toBuilt(pkg.main),
    types: toTypes(pkg.types),
    exports: remapExports(pkg.exports),
    ...(pkg.bin ? { bin: remapBin(pkg.bin) } : {}),
    files: [
        'dist',
        ...(existsSync(migrations) ? ['migrations'] : []),
        ...(existsSync(templates) ? ['templates'] : [])
    ],
    dependencies: resolveDependencies(pkg.dependencies),
    ...(pkg.peerDependencies ? { peerDependencies: pkg.peerDependencies } : {}),
    ...(pkg.peerDependenciesMeta
        ? { peerDependenciesMeta: pkg.peerDependenciesMeta }
        : {}),
    // Scoped packages publish as restricted by default, which fails for an
    // account without a paid org. Say what we mean instead.
    publishConfig: { access: 'public' }
};

// Verify BEFORE writing. The order is the whole point: `dist/pack` is a
// directory other tools walk and trust — `reserve-names.mjs` reads it to decide
// which npm names to create, and the release publishes what it finds there.
// Writing first meant a *failed* pack still left a complete-looking staged
// package behind, missing exactly the dependency the check had objected to, and
// nothing downstream re-ran the check. The task went red and the artifact
// stayed. A staged package must mean a package that passed.
verifyEntryPoints(staged);
verifyDependenciesAreDeclared(staged);

writeFileSync(
    join(stagingDir, 'package.json'),
    `${JSON.stringify(staged, null, 4)}\n`
);

console.log(
    `packed ${pkg.name}@${pkg.version} → ${relative(workspaceRoot, stagingDir)}`
);

/* ---------------------------------------------------------------- helpers */

/**
 * `./src/index.ts` → `./dist/index.js`. Non-TS paths (a stylesheet) keep
 * their extension; anything already outside `src/` (`./package.json`) is
 * left alone.
 */
function toBuilt(path) {
    if (typeof path !== 'string' || !path.startsWith('./src/')) return path;
    return path.replace(/^\.\/src\//, './dist/').replace(/\.tsx?$/, '.js');
}

function toTypes(path) {
    if (typeof path !== 'string' || !path.startsWith('./src/')) return path;
    return path.replace(/^\.\/src\//, './dist/').replace(/\.tsx?$/, '.d.ts');
}

/**
 * `bin` points at TypeScript source in the workspace, the same way `main`
 * does, and npm links it verbatim — so an unremapped `./src/cli.ts` publishes
 * a command that dies on its first `npx`. Both spellings npm accepts are
 * handled: a bare string (the command takes the package's name) and a map.
 */
function remapBin(bin) {
    if (typeof bin === 'string') return toBuilt(bin);

    return Object.fromEntries(
        Object.entries(bin).map(([command, path]) => [command, toBuilt(path)])
    );
}

/**
 * Every subpath in the workspace manifest points at TypeScript source. The
 * published one offers the declarations first (so `types` wins for tsc) and
 * the compiled JS as the default.
 */
function remapExports(exports) {
    if (!exports) return undefined;

    const remapped = {};

    for (const [subpath, value] of Object.entries(exports)) {
        if (typeof value === 'string') {
            remapped[subpath] = /\.tsx?$/.test(value)
                ? { types: toTypes(value), default: toBuilt(value) }
                : toBuilt(value);
            continue;
        }

        // A conditions object — in this workspace every branch names the same
        // source file, so any of them identifies the entry point.
        const source = value.types ?? value.import ?? value.default;
        if (!source)
            fail(`export "${subpath}" of ${pkg.name} has no resolvable entry`);

        remapped[subpath] = {
            types: toTypes(source),
            default: toBuilt(source)
        };
    }

    return remapped;
}

/**
 * Workspace dependencies are declared as `"*"`, which on the registry means
 * "whatever is latest" — never what the package was built against. Pin each
 * to the version its own manifest carries at release time.
 */
function resolveDependencies(dependencies) {
    const resolved = {};

    for (const [name, range] of Object.entries(dependencies ?? {})) {
        if (range !== '*') {
            resolved[name] = range;
            continue;
        }

        const dep = workspaceManifest(name);
        if (!dep)
            fail(
                `${pkg.name} depends on ${name} at "*", but it is not a workspace package`
            );
        if (dep.private)
            fail(
                `${pkg.name} depends on ${name}, which is private and will never be published`
            );

        resolved[name] = `^${dep.version}`;
    }

    // `importHelpers` is on workspace-wide, so the emitted JS reaches for
    // tslib at runtime whether or not the source ever mentions it.
    resolved.tslib ??= rootPkg.devDependencies.tslib ?? '^2.3.0';

    return sortKeys(resolved);
}

/**
 * Packages are either flat (`packages/<name>`) or grouped
 * (`packages/<group>/<name>`), so both shapes are searched — the same two
 * levels the root `workspaces` globs cover.
 */
function workspaceManifest(name) {
    const packagesDir = join(workspaceRoot, 'packages');

    for (const dir of [
        ...childDirs(packagesDir),
        ...childDirs(packagesDir).flatMap(childDirs)
    ]) {
        const file = join(dir, 'package.json');
        if (!existsSync(file)) continue;
        const manifest = readJson(file);
        if (manifest.name === name) return manifest;
    }

    return undefined;
}

function childDirs(root) {
    return readdirSync(root)
        .map((entry) => join(root, entry))
        .filter((entry) => statSync(entry).isDirectory());
}

function assetsIn(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return assetsIn(path);
        return /\.(ts|tsx)$/.test(entry.name) ? [] : [path];
    });
}

/**
 * A tarball whose `exports` name a file the build never emitted installs
 * fine and explodes on the consumer's first import. Catch it here, while the
 * only cost is a failed release.
 */
function verifyEntryPoints(manifest) {
    const paths = new Set([manifest.main, manifest.types]);

    // A `bin` naming a file the build never emitted is the worst of these to
    // ship: it installs cleanly and only fails at `npx`, on someone else's
    // machine, with a message about the command not existing.
    if (typeof manifest.bin === 'string') paths.add(manifest.bin);
    else Object.values(manifest.bin ?? {}).forEach((path) => paths.add(path));

    for (const value of Object.values(manifest.exports ?? {})) {
        if (typeof value === 'string') paths.add(value);
        else Object.values(value).forEach((path) => paths.add(path));
    }

    const missing = [...paths]
        .filter((path) => typeof path === 'string' && path !== './package.json')
        .filter((path) => !existsSync(join(stagingDir, path)));

    if (missing.length) {
        fail(
            `${manifest.name} declares entry points that were not built: ${missing.join(', ')}`
        );
    }
}

/**
 * Catches the phantom dependency — a package importing something only the
 * *workspace root* depends on. npm hoists it into the shared `node_modules`,
 * so it resolves in development and in the apps, and is simply absent from
 * the consumer's tree once the package is installed from the registry.
 *
 * Type-only imports count: they end up in the emitted `.d.ts`, and a
 * consumer that cannot resolve them gets the errors instead of us.
 */
function verifyDependenciesAreDeclared(manifest) {
    const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        manifest.name
    ]);

    const undeclared = new Map();

    for (const file of sourceFiles(join(projectDir, 'src'))) {
        const { importedFiles } = ts.preProcessFile(
            readFileSync(file, 'utf8'),
            true,
            true
        );

        for (const { fileName: specifier } of importedFiles) {
            if (specifier.startsWith('.') || specifier.startsWith('/'))
                continue;

            // `@scope/name/subpath` and `name/subpath` both belong to the
            // package named by their first segment (or first two, if scoped).
            const segments = specifier.split('/');
            const name = specifier.startsWith('@')
                ? segments.slice(0, 2).join('/')
                : segments[0];

            if (declared.has(name)) continue;
            if (name.startsWith('node:') || builtinModules.includes(name))
                continue;

            if (!undeclared.has(name))
                undeclared.set(name, relative(projectDir, file));
        }
    }

    if (undeclared.size) {
        const detail = [...undeclared].map(
            ([name, file]) => `  ${name} (imported by ${file})`
        );
        fail(
            `${manifest.name} imports packages it does not declare:\n${detail.join('\n')}`
        );
    }
}

/**
 * Everything the library build compiles, under `dir`.
 *
 * The package's own `tsconfig.lib.json` is the authority, not a filename
 * convention: a spec is only one of the things a build leaves out. Test
 * scaffolding that is *not* named `.spec.` — a `__test__/harness.tsx`, a
 * `test-setup.ts` — is excluded there and compiled nowhere, so it reaches no
 * consumer and cannot owe them a dependency. Walking the tree by name instead
 * read those files, found `@testing-library/react`, and refused to stage a
 * package whose tarball would never contain the import.
 *
 * Which excludes apply differs per package — some do compile their `__test__`
 * helpers, and a few still compile their specs — so this asks the compiler
 * rather than restating the rules, and keeps the name filter on top of the
 * answer: a spec that gets compiled anyway is a tidiness problem, not a
 * dependency a consumer can be handed a broken import through.
 */
function sourceFiles(dir) {
    const configPath = join(projectDir, 'tsconfig.lib.json');
    if (!existsSync(configPath)) return walkSources(dir);

    const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
                fail(
                    `cannot read ${relative(workspaceRoot, configPath)}: ` +
                        ts.flattenDiagnosticMessageText(
                            diagnostic.messageText,
                            ' '
                        )
                )
        }
    );

    const prefix = `${dir.replace(/\\/g, '/')}/`;
    return (parsed?.fileNames ?? [])
        .map((file) => file.replace(/\\/g, '/'))
        .filter((file) => file.startsWith(prefix))
        .filter((file) => !/\.(spec|test)\./.test(file));
}

/**
 * The fallback for a package with no `tsconfig.lib.json`: every TypeScript
 * file under `dir` that is not itself a spec.
 */
function walkSources(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walkSources(path);
        if (!/\.tsx?$/.test(entry.name)) return [];
        return /\.(spec|test)\./.test(entry.name) ? [] : [path];
    });
}

function sortKeys(record) {
    return Object.fromEntries(
        Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
    );
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function stubReadme(name) {
    return [
        `# ${name}`,
        '',
        `Part of [Ortha CMS](${website}) — the source is on`,
        `[GitHub](${repoWeb}/tree/main/${projectRoot}).`,
        '',
        '```sh',
        `npm install ${name}`,
        '```',
        ''
    ].join('\n');
}

function fail(message) {
    console.error(`pack: ${message}`);
    process.exit(1);
}
