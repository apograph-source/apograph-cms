/**
 * Creates the `@ortha/*` **package names** on npm, ahead of a release and
 * separately from it.
 *
 * npm meters two different things. How fast an account *writes* is handled by
 * the publish executor — a workspace-wide slot with a gap, and a backoff on
 * 429 (see `packages/nx/src/lib/release/`). Creating a **brand-new package
 * name** is metered on its own, far tighter, per-day schedule that no backoff
 * outlasts, and a lockstep release asks for 37 of them at once. The release
 * versions, commits, tags and pushes *before* it publishes, so a name refused
 * partway down the list leaves a tag in the repository and half a release on
 * the registry.
 *
 * So names are seeded first, over as many days as the limit demands, and the
 * release is left to do only what it is good at: bumping versions on names
 * that already exist.
 *
 *     npx nx run-many -t build,pack --projects=@ortha/*
 *     node tools/release/reserve-names.mjs --limit=20
 *
 * What goes out is the **real staged tarball** at a prerelease version under a
 * non-`latest` dist-tag — not an empty placeholder, which is what an
 * anti-abuse system reads as name squatting, the last thing to do while
 * rationed. The tag does not keep `latest` off it: npm points `latest` at a
 * package's first version whatever `--tag` says, so until the real release
 * `npm install @ortha/<name>` installs the reserved build.
 *
 * The reserved version does not disturb versioning: `nx.json` derives the next
 * version from conventional commits against the git tag, with a `disk`
 * fallback, and never asks the registry.
 *
 * Options:
 *
 *     --limit=<n>       most names to create in this run (default 20)
 *     --version=<v>     the reserved version (default 0.0.0-reserve.0)
 *     --tag=<t>         dist-tag to publish it under (default `reserve`)
 *     --registry=<url>  publish and probe somewhere else (a local Verdaccio)
 *     --dry-run         probe and report, write nothing
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const workspaceRoot = process.cwd();

const DEFAULTS = {
    limit: 20,
    version: '0.0.0-reserve.0',
    tag: 'reserve',
    /** Seconds between two writes, the same gap the publish executor leaves. */
    gap: 5_000
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = Number(option('limit') ?? DEFAULTS.limit);
const version = option('version') ?? DEFAULTS.version;
const tag = option('tag') ?? DEFAULTS.tag;

loadDotEnv();

const env = { ...process.env };
const registry =
    option('registry') ||
    npmConfig('registry') ||
    'https://registry.npmjs.org/';

configureNpmAuth();

/* ------------------------------------------------------------------- run */

const staged = findStaged(join(workspaceRoot, 'dist', 'pack'));

if (staged.length === 0) {
    fail(
        'reserve: nothing staged under dist/pack.\n' +
            '        Run `npx nx run-many -t build,pack --projects=@ortha/*` first.'
    );
}

console.log(
    `reserve: ${staged.length} staged package(s); creating at most ${limit} name(s) ` +
        `as ${version} under the "${tag}" tag${dryRun ? ' (dry run)' : ''}\n`
);

const created = [];
const existing = [];
const pending = [];
let stopped = null;

for (const pkg of staged) {
    if (await nameExists(pkg.name)) {
        existing.push(pkg.name);
        console.log(`  · ${pkg.name} — already on the registry`);
        continue;
    }

    if (stopped || created.length >= limit) {
        pending.push(pkg.name);
        continue;
    }

    if (dryRun) {
        created.push(pkg.name);
        console.log(`  + ${pkg.name} — would be created`);
        continue;
    }

    // The gap belongs *between* writes; the first one waits for nothing.
    if (created.length > 0) await sleep(DEFAULTS.gap);

    const failure = publish(pkg);

    // A name created minutes ago can still 404 on the packument read while the
    // registry refuses to publish the version again — the probe is eventually
    // consistent, the write is not. That refusal is the answer the probe could
    // not give yet, not a rate limit, so it must not end the run.
    if (
        failure &&
        /cannot publish over the previously published versions/i.test(failure)
    ) {
        existing.push(pkg.name);
        console.log(
            `  · ${pkg.name} — already published (the registry is not showing it yet)`
        );
        continue;
    }

    if (failure) {
        stopped = { name: pkg.name, output: failure };
        pending.push(pkg.name);
        continue;
    }

    created.push(pkg.name);
    console.log(`  ✓ ${pkg.name} — created (${created.length})`);
}

/* --------------------------------------------------------------- summary */

console.log(
    `\nreserve: ${created.length} ${dryRun ? 'to create' : 'created'}, ` +
        `${existing.length} already there, ${pending.length} still to do`
);

if (stopped) {
    console.error(
        `\nreserve: stopped at ${stopped.name}. Every refused creation is a signal to the\n` +
            '        rate limiter, so the rest of the queue was left alone rather than\n' +
            '        spending a request each to be told the same thing. Wait for the\n' +
            '        limit to roll over and run this again — the names already created\n' +
            '        are skipped by the probe, not republished.\n\n' +
            indent(stopped.output)
    );
    process.exit(1);
}

if (pending.length > 0) {
    console.log(
        `\nreserve: run again when the limit rolls over to create:\n` +
            pending.map((name) => `        ${name}`).join('\n')
    );
} else {
    console.log(
        dryRun
            ? '\nreserve: nothing left to create once this run is done for real.'
            : '\nreserve: every name exists — `npm run release` now only bumps versions.'
    );
}

/* --------------------------------------------------------------- helpers */

/**
 * Every staged package root `pack` produced. They sit at
 * `dist/pack/<projectRoot>/`, which is two levels deep for a flat package and
 * three for a grouped one, so the walk stops at whatever directory holds a
 * `package.json` rather than assuming a depth.
 */
function findStaged(dir, depth = 0) {
    if (!existsSync(dir) || depth > 3) return [];

    const found = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const path = join(dir, entry.name);
        const manifest = join(path, 'package.json');

        if (existsSync(manifest)) {
            const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
            if (!pkg.private) found.push({ path, manifest, name: pkg.name });
            continue;
        }

        found.push(...findStaged(path, depth + 1));
    }

    return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A packument `GET` — not a metered write — asking whether this publish would
 * create a name or add a version to one. Anything other than a clean 404 is
 * read as "the name exists", because a probe that cannot answer must never be
 * the reason a name gets created twice.
 */
async function nameExists(name) {
    const base = registry.endsWith('/') ? registry : `${registry}/`;
    const token = env.NPM_TOKEN ?? env.NODE_AUTH_TOKEN;

    try {
        const response = await fetch(new URL(name.replace('/', '%2f'), base), {
            headers: {
                accept: 'application/vnd.npm.install-v1+json, application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {})
            }
        });

        return response.status !== 404;
    } catch {
        console.warn(`  ? ${name} — could not reach the registry; skipping it`);
        return true;
    }
}

/**
 * Publishes one staged package at the reserved version, then puts the staged
 * manifest back. `pack` wrote the release version in there and the real
 * release publishes from the same directory, so the edit has to be temporary
 * even when the publish throws.
 *
 * Returns npm's output on failure, or `null` when it went out.
 */
function publish(pkg) {
    const original = readFileSync(pkg.manifest, 'utf8');

    writeFileSync(
        pkg.manifest,
        `${JSON.stringify({ ...JSON.parse(original), version }, null, 4)}\n`
    );

    try {
        execFileSync(
            'npm',
            [
                'publish',
                pkg.path,
                `--tag=${tag}`,
                '--access=public',
                `--registry=${registry}`
            ],
            { cwd: workspaceRoot, env, encoding: 'utf8', stdio: 'pipe' }
        );

        return null;
    } catch (error) {
        return `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    } finally {
        writeFileSync(pkg.manifest, original);
    }
}

/** Node's own `.env` loader, leaving anything already exported in the shell alone. */
function loadDotEnv() {
    const envFile = join(workspaceRoot, '.env');

    if (!existsSync(envFile)) {
        console.log(
            'reserve: no .env at the workspace root; using the shell environment only'
        );
        return;
    }

    if (typeof process.loadEnvFile !== 'function') {
        fail(
            'reserve: Node 20.12 or newer is required to read .env (process.loadEnvFile)'
        );
    }

    process.loadEnvFile(envFile);
    console.log('reserve: loaded .env');
}

/**
 * Hands npm the token as configuration in the child's environment, keyed by
 * the registry it authenticates to — the same way `release.mjs` does it, so
 * one `NPM_TOKEN` in `.env` serves both.
 */
function configureNpmAuth() {
    const token = env.NPM_TOKEN ?? env.NODE_AUTH_TOKEN;

    if (!token) {
        const user = whoamiOrNull();

        if (!user) {
            // A dry run writes nothing, so it has nothing to authenticate for.
            if (dryRun) {
                console.log(
                    'reserve: no npm credentials, but none are needed to rehearse'
                );
                return;
            }

            fail(
                'reserve: no NPM_TOKEN in .env and npm is not logged in.\n' +
                    '        Add NPM_TOKEN=… to .env, or run `npm login`.'
            );
        }

        console.log(
            `reserve: publishing as npm user "${user}" (no NPM_TOKEN set)`
        );
        return;
    }

    const key = `${registry.replace(/^https?:/, '').replace(/\/?$/, '/')}:_authToken`;

    env[`npm_config_${key}`] = token;
    console.log(`reserve: authenticating to ${registry} with NPM_TOKEN`);
}

function whoamiOrNull() {
    try {
        return execFileSync('npm', ['whoami', `--registry=${registry}`], {
            env,
            encoding: 'utf8',
            // Its "ENEEDAUTH" is an answer here, not an error worth printing.
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch {
        return null;
    }
}

function npmConfig(key) {
    try {
        const value = execFileSync('npm', ['config', 'get', key], {
            env: process.env,
            encoding: 'utf8'
        }).trim();

        return value === 'undefined' || value === 'null' ? '' : value;
    } catch {
        return '';
    }
}

function option(name) {
    const match = args.find((arg) => arg.startsWith(`--${name}=`));

    return match ? match.slice(name.length + 3) : null;
}

function indent(text) {
    return text
        .split('\n')
        .map((line) => `        ${line}`)
        .join('\n');
}

function fail(message) {
    console.error(`\n${message}\n`);
    process.exit(1);
}
