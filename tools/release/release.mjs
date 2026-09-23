/**
 * The manual release: publish every package to npm and open the GitHub
 * Release, from a checkout of `main`.
 *
 *     npm run release              # the real thing
 *     npm run release:dry-run      # rehearse; writes, pushes and publishes nothing
 *     npm run release -- 1.2.0     # force a version instead of deriving one
 *     npm run release:publish      # publish only, to finish a partial release
 *
 * `nx release` asks for confirmation before it publishes, and that prompt is
 * deliberately left in place — publishing to a public registry cannot be
 * undone, and a version number can never be reused. Pass `--yes` to skip it
 * only for an unattended run.
 *
 * Credentials come from `.env` at the workspace root (git-ignored), which
 * this script loads before handing off to `nx release`:
 *
 *     NPM_TOKEN=npm_…             # automation token with publish rights on @orthacms
 *     GITHUB_TOKEN=ghp_…          # a token that can create a release on this repo
 *
 * Anything already exported in the shell wins over the file. `NPM_TOKEN` is
 * passed to npm as configuration in the child's environment, so it is never
 * written to an `.npmrc` — leave it out entirely if you would rather stay
 * logged in with `npm login`.
 *
 * Everything before the handoff is preflight. `nx release` versions, commits,
 * tags and pushes *before* it publishes or creates the release, so a missing
 * token discovered late leaves a tagged commit and nothing on the registry.
 * Better to refuse to start.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceRoot = process.cwd();
const RELEASE_BRANCH = 'main';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const publishOnly = args.includes('--publish-only');
const allowBranch = args.includes('--allow-branch');
const passthrough = args.filter(
    (arg) => !['--publish-only', '--allow-branch'].includes(arg)
);

loadDotEnv();

const env = { ...process.env };

/* -------------------------------------------------------------- preflight */

if (!publishOnly) {
    requireReleaseBranch();
    requireCleanTree();
    requireUpToDateWithRemote();
}

configureNpmAuth();

if (!publishOnly && !dryRun) requireGithubToken();

/* ---------------------------------------------------------------- handoff */

const nxArgs = publishOnly
    ? [
          'nx',
          'release',
          'publish',
          ...passthrough.filter((a) => a !== '--dry-run'),
          ...(dryRun ? ['--dry-run'] : [])
      ]
    : ['nx', 'release', ...passthrough];

console.log(`\n▶ npx ${nxArgs.join(' ')}\n`);

const result = spawnSync('npx', nxArgs, {
    cwd: workspaceRoot,
    env,
    stdio: 'inherit'
});

if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);

/* ---------------------------------------------------------------- helpers */

/**
 * Node's own `.env` loader — it leaves anything already exported in the shell
 * alone, so `GITHUB_TOKEN=… npm run release` still overrides the file.
 */
function loadDotEnv() {
    const envFile = join(workspaceRoot, '.env');

    if (!existsSync(envFile)) {
        console.log(
            'release: no .env at the workspace root; using the shell environment only'
        );
        return;
    }

    if (typeof process.loadEnvFile !== 'function') {
        fail(
            'release: Node 20.12 or newer is required to read .env (process.loadEnvFile)'
        );
    }

    process.loadEnvFile(envFile);
    console.log('release: loaded .env');
}

/**
 * Hands npm the token as configuration in the child's environment. The key
 * has to name the registry it authenticates to, so it is derived from
 * whatever registry npm is actually configured to use.
 */
function configureNpmAuth() {
    const token = env.NPM_TOKEN ?? env.NODE_AUTH_TOKEN;

    if (!token) {
        const user = whoamiOrNull();
        if (!user) {
            fail(
                'release: no NPM_TOKEN in .env and npm is not logged in.\n' +
                    '        Add NPM_TOKEN=… to .env, or run `npm login`.'
            );
        }
        console.log(
            `release: publishing as npm user "${user}" (no NPM_TOKEN set)`
        );
        return;
    }

    const registry = npmConfig('registry') || 'https://registry.npmjs.org/';
    // npm keys auth by registry origin, written without a protocol and with a
    // trailing slash: `//registry.npmjs.org/:_authToken`.
    const key = `${registry.replace(/^https?:/, '').replace(/\/?$/, '/')}:_authToken`;

    env[`npm_config_${key}`] = token;
    console.log(`release: authenticating to ${registry} with NPM_TOKEN`);
}

/**
 * Nx creates the GitHub Release with this token. It is the last step of the
 * run, long after the tag has been pushed, which is exactly why it is checked
 * first.
 */
function requireGithubToken() {
    if (env.GITHUB_TOKEN || env.GH_TOKEN) {
        console.log(
            'release: GitHub Release will be created with GITHUB_TOKEN'
        );
        return;
    }

    fail(
        'release: no GITHUB_TOKEN in .env, so the GitHub Release step would fail\n' +
            '        after the version had already been committed, tagged and pushed.\n' +
            '        Add GITHUB_TOKEN=… to .env (a token with `repo` access), or pass\n' +
            '        --dry-run to rehearse without it.'
    );
}

function requireReleaseBranch() {
    const branch = git('rev-parse --abbrev-ref HEAD');

    if (branch === RELEASE_BRANCH || allowBranch) return;

    fail(
        `release: on branch "${branch}", but a release is cut from "${RELEASE_BRANCH}".\n` +
            `        \`git checkout ${RELEASE_BRANCH} && git pull\`, or pass --allow-branch if you mean it.`
    );
}

function requireCleanTree() {
    if (!git('status --porcelain')) return;

    fail(
        'release: the working tree has uncommitted changes.\n' +
            '        Versioning commits and tags whatever is here — commit or stash first.'
    );
}

/**
 * A release off a stale checkout tags an old commit and publishes code that
 * is not what `main` says it is.
 */
function requireUpToDateWithRemote() {
    try {
        execFileSync('git', ['fetch', 'origin', RELEASE_BRANCH], {
            cwd: workspaceRoot,
            stdio: 'ignore'
        });
    } catch {
        console.warn(
            'release: could not reach origin; skipping the up-to-date check'
        );
        return;
    }

    const behind = git(`rev-list --count HEAD..origin/${RELEASE_BRANCH}`);

    if (behind !== '0') {
        fail(
            `release: ${behind} commit(s) behind origin/${RELEASE_BRANCH}. Run \`git pull\` first.`
        );
    }
}

function whoamiOrNull() {
    try {
        return execFileSync('npm', ['whoami'], {
            env,
            encoding: 'utf8'
        }).trim();
    } catch {
        return null;
    }
}

function npmConfig(key) {
    try {
        const value = execFileSync('npm', ['config', 'get', key], {
            env,
            encoding: 'utf8'
        }).trim();
        return value === 'undefined' || value === 'null' ? '' : value;
    } catch {
        return '';
    }
}

function git(command) {
    return execFileSync('git', command.split(' '), {
        cwd: workspaceRoot,
        encoding: 'utf8'
    }).trim();
}

function fail(message) {
    console.error(`\n${message}\n`);
    process.exit(1);
}
