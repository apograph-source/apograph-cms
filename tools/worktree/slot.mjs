#!/usr/bin/env node
/**
 * Parallel dev **stack slots** — one running stack per git worktree, so
 * several agents can each hold a ticket open with its own API, admin and
 * database instead of queueing on one set of ports.
 *
 * A "slot" is just an integer that fixes three things:
 *
 *   slot 0 (the main checkout)  PORT=3000  ADMIN_PORT=4200  db ortha_cms
 *   slot 1                      PORT=3001  ADMIN_PORT=4201  db ortha_cms_a1
 *   slot n                      PORT=300n  ADMIN_PORT=420n  db ortha_cms_an
 *
 * Databases are *not* separate containers. Five Postgres containers cost five
 * times the memory to isolate data that a `CREATE DATABASE` already isolates,
 * so every slot shares the one `docker compose up` server and gets its own
 * database inside it. That also keeps `docker-compose.yml` free of the
 * per-slot port/volume/container-name juggling it would otherwise need.
 *
 * Usage:
 *   node tools/worktree/slot.mjs provision <slot> [--path <dir>] [--from <env>]
 *   node tools/worktree/slot.mjs list
 *   node tools/worktree/slot.mjs release <slot> --yes
 *
 * See docs/parallel-stacks.md for the end-to-end workflow.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';

/** Slots above this are refused — the ports stop being predictable at 10. */
const MAX_SLOT = 9;
const API_PORT_BASE = 3000;
const ADMIN_PORT_BASE = 4200;
/** Slot 0's database; slot n appends `_a<n>`. */
const BASE_DATABASE = 'ortha_cms';
/** `container_name` in docker-compose.yml. */
const DEFAULT_CONTAINER = 'ortha-postgres';

/** What slot `n` is entitled to. */
function slotPlan(slot) {
    return {
        slot,
        apiPort: API_PORT_BASE + slot,
        adminPort: ADMIN_PORT_BASE + slot,
        database: slot === 0 ? BASE_DATABASE : `${BASE_DATABASE}_a${slot}`
    };
}

function fail(message) {
    console.error(`slot: ${message}`);
    process.exit(1);
}

function parseSlot(raw) {
    const slot = Number(raw);
    if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
        fail(
            `slot must be an integer 0–${MAX_SLOT}, got ${JSON.stringify(raw)}`
        );
    }
    return slot;
}

/** `--flag value` and bare `--flag`, plus positionals. */
function parseArgs(argv) {
    const positionals = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            positionals.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[key] = next;
            i++;
        } else {
            flags[key] = true;
        }
    }
    return { positionals, flags };
}

function git(args, cwd = process.cwd()) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * The checkout holding the real `.git` directory — where `docker-compose.yml`
 * is run from and whose `.env` seeds every slot. Linked worktrees all point at
 * the same common dir, so this resolves identically from any of them.
 */
function mainCheckout() {
    const commonDir = git([
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir'
    ]);
    return dirname(commonDir);
}

/** `[{ path, branch }]` for every worktree of this repository. */
function worktrees() {
    const out = git(['worktree', 'list', '--porcelain']);
    const entries = [];
    let current = null;
    for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
            current = { path: line.slice('worktree '.length), branch: null };
            entries.push(current);
        } else if (line.startsWith('branch ') && current) {
            current.branch = line.slice('branch refs/heads/'.length);
        } else if (line === 'detached' && current) {
            current.branch = '(detached)';
        }
    }
    return entries;
}

/**
 * Minimal `.env` reader — `KEY=value`, `#` comments, optional surrounding
 * quotes. Enough for the handful of keys this script reads; the apps
 * themselves are loaded by Nx/Vite, which do the full job.
 */
function readEnv(path) {
    const values = {};
    if (!existsSync(path)) {
        return values;
    }
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const eq = trimmed.indexOf('=');
        if (eq === -1) {
            continue;
        }
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

/**
 * Rewrite the managed keys in place — position and comments preserved — and
 * append the ones the source file never had.
 */
function applyOverrides(source, overrides) {
    const remaining = new Set(Object.keys(overrides));
    const lines = source.split('\n').map((line) => {
        const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (!match) {
            return line;
        }
        const key = match[2];
        if (!(key in overrides)) {
            return line;
        }
        remaining.delete(key);
        return `${match[1]}${key}=${overrides[key]}`;
    });

    if (remaining.size > 0) {
        lines.push(
            '',
            '# --- parallel stack slot (tools/worktree/slot.mjs) ---'
        );
        for (const key of Object.keys(overrides)) {
            if (remaining.has(key)) {
                lines.push(`${key}=${overrides[key]}`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

/** Swap the database name on a connection string, leaving credentials alone. */
function withDatabase(url, database) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        fail(`DATABASE_URL is not a valid URL: ${url}`);
    }
    parsed.pathname = `/${database}`;
    return parsed.toString();
}

/**
 * Pick how to reach Postgres, once: the compose container if it is running,
 * otherwise a `psql` on PATH. Returns `run(sql, database)`.
 */
function psqlRunner({ url, container }) {
    const parsed = new URL(url);
    const user = decodeURIComponent(parsed.username) || 'postgres';
    const password = decodeURIComponent(parsed.password);

    const containerRunning = (() => {
        try {
            const state = execFileSync(
                'docker',
                ['inspect', '-f', '{{.State.Running}}', container],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            ).trim();
            return state === 'true';
        } catch {
            return false;
        }
    })();

    if (containerRunning) {
        return {
            via: `docker exec ${container}`,
            run: (sql, database) =>
                execFileSync(
                    'docker',
                    [
                        'exec',
                        '-e',
                        `PGPASSWORD=${password}`,
                        container,
                        'psql',
                        '-U',
                        user,
                        '-d',
                        database,
                        '-tAc',
                        sql
                    ],
                    { encoding: 'utf8' }
                ).trim()
        };
    }

    try {
        execFileSync('psql', ['--version'], { stdio: 'ignore' });
    } catch {
        fail(
            `neither the \`${container}\` container nor a local \`psql\` is available.\n` +
                '       Start Postgres with `docker compose up -d`, or pass --container <name>,\n' +
                '       or re-run with --no-db and create the database yourself.'
        );
    }

    return {
        via: 'psql (host)',
        run: (sql, database) => {
            const target = new URL(url);
            target.pathname = `/${database}`;
            return execFileSync('psql', [target.toString(), '-tAc', sql], {
                encoding: 'utf8',
                env: { ...process.env, PGPASSWORD: password }
            }).trim();
        }
    };
}

function databaseExists(psql, name) {
    return (
        psql.run(
            `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
            'postgres'
        ) === '1'
    );
}

/** Is something already listening there? Used only to report, never to gate. */
function probePort(port) {
    return new Promise((done) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        const settle = (result) => {
            socket.destroy();
            done(result);
        };
        socket.setTimeout(300);
        socket.on('connect', () => settle(true));
        socket.on('timeout', () => settle(false));
        socket.on('error', () => settle(false));
    });
}

function provision({ positionals, flags }) {
    const slot = parseSlot(positionals[0]);
    if (slot === 0) {
        fail(
            'slot 0 is the main checkout — it already owns :3000/:4200 and `ortha_cms`.'
        );
    }
    const plan = slotPlan(slot);

    const main = mainCheckout();
    const target = resolve(
        typeof flags['path'] === 'string' ? flags['path'] : process.cwd()
    );
    if (!existsSync(join(target, 'package.json'))) {
        fail(`${target} does not look like a checkout (no package.json).`);
    }
    if (resolve(target) === resolve(main)) {
        fail(
            'refusing to provision the main checkout — pass --path <worktree>, or run\n' +
                '       this from inside the worktree you want to set up.'
        );
    }

    const sourceEnvPath =
        typeof flags['from'] === 'string'
            ? resolve(flags['from'])
            : join(main, '.env');
    if (!existsSync(sourceEnvPath)) {
        fail(
            `no source .env at ${sourceEnvPath} — copy .env.example there first, or pass --from <file>.`
        );
    }

    const targetEnvPath = join(target, '.env');
    if (existsSync(targetEnvPath) && !flags['force']) {
        fail(`${targetEnvPath} already exists — pass --force to overwrite it.`);
    }

    const sourceText = readFileSync(sourceEnvPath, 'utf8');
    const sourceEnv = readEnv(sourceEnvPath);
    const sourceUrl =
        sourceEnv['DATABASE_URL'] ||
        'postgresql://ortha:ortha@localhost:5432/ortha_cms';
    const databaseUrl = withDatabase(sourceUrl, plan.database);

    // The database first: a written .env pointing at a database that does not
    // exist is a stack that boots and then fails on its first query.
    if (flags['no-db']) {
        console.log(`- database   ${plan.database} (skipped, --no-db)`);
    } else {
        const container =
            typeof flags['container'] === 'string'
                ? flags['container']
                : DEFAULT_CONTAINER;
        const psql = psqlRunner({ url: sourceUrl, container });
        if (databaseExists(psql, plan.database)) {
            console.log(
                `- database   ${plan.database} (already exists, via ${psql.via})`
            );
        } else {
            psql.run(`CREATE DATABASE "${plan.database}"`, 'postgres');
            console.log(
                `- database   ${plan.database} (created, via ${psql.via})`
            );
        }
    }

    writeFileSync(
        targetEnvPath,
        applyOverrides(sourceText, {
            PORT: String(plan.apiPort),
            ADMIN_PORT: String(plan.adminPort),
            DATABASE_URL: databaseUrl
        })
    );

    console.log(`- env        ${targetEnvPath} (copied from ${sourceEnvPath})`);
    console.log(`- api        http://localhost:${plan.apiPort}`);
    console.log(`- admin      http://localhost:${plan.adminPort}`);
    console.log('');
    console.log(
        `slot ${slot} is provisioned. The database is empty — from ${target}:`
    );
    console.log('');
    console.log(
        '  npm install                        # worktrees start without node_modules'
    );
    console.log(
        "  npx nx run server:db:migrate       # apply every plugin's migrations"
    );
    console.log(
        "  npm run dev                        # the whole stack, on this slot's ports"
    );
    console.log('');
    console.log(
        'Note: the .env is a verbatim copy, secrets included — it is git-ignored, keep it local.'
    );
}

async function list() {
    const main = resolve(mainCheckout());
    const rows = [];

    for (const tree of worktrees()) {
        const env = readEnv(join(tree.path, '.env'));
        const apiPort = Number(env['PORT']) || API_PORT_BASE;
        const adminPort = Number(env['ADMIN_PORT']) || ADMIN_PORT_BASE;
        let database = '(none)';
        if (env['DATABASE_URL']) {
            try {
                database =
                    new URL(env['DATABASE_URL']).pathname.slice(1) || '(none)';
            } catch {
                database = '(unparseable)';
            }
        }
        const [apiUp, adminUp] = await Promise.all([
            probePort(apiPort),
            probePort(adminPort)
        ]);
        rows.push({
            path:
                resolve(tree.path) === main ? `${tree.path} (main)` : tree.path,
            branch: tree.branch ?? '-',
            env: existsSync(join(tree.path, '.env')),
            apiPort,
            adminPort,
            database,
            up:
                apiUp || adminUp
                    ? `${apiUp ? 'api' : '-'}/${adminUp ? 'admin' : '-'}`
                    : 'down'
        });
    }

    console.log('');
    for (const row of rows) {
        console.log(`${row.branch}`);
        console.log(`  path      ${row.path}`);
        console.log(
            `  .env      ${row.env ? 'present' : 'MISSING — run `provision`'}`
        );
        console.log(`  api       :${row.apiPort}`);
        console.log(`  admin     :${row.adminPort}`);
        console.log(`  database  ${row.database}`);
        console.log(`  running   ${row.up}`);
        console.log('');
    }

    // Databases with no worktree left pointing at them — the residue of a
    // removed worktree, and the thing that quietly fills the volume.
    const claimed = new Set(rows.map((row) => row.database));
    try {
        const env = readEnv(join(main, '.env'));
        const psql = psqlRunner({
            url:
                env['DATABASE_URL'] ||
                'postgresql://ortha:ortha@localhost:5432/ortha_cms',
            container: DEFAULT_CONTAINER
        });
        const all = psql
            .run(
                `SELECT datname FROM pg_database WHERE datname LIKE '${BASE_DATABASE}%' ORDER BY datname`,
                'postgres'
            )
            .split('\n')
            .map((name) => name.trim())
            .filter(Boolean);
        const orphans = all.filter((name) => !claimed.has(name));
        if (orphans.length > 0) {
            console.log(`unclaimed databases: ${orphans.join(', ')}`);
            console.log('  (drop with `release <slot> --yes`)');
            console.log('');
        }
    } catch {
        // Postgres not reachable — the worktree/port view above still stands.
    }
}

function release({ positionals, flags }) {
    const slot = parseSlot(positionals[0]);
    if (slot === 0) {
        fail(
            `refusing to drop ${BASE_DATABASE} — slot 0 is the main checkout's database.`
        );
    }
    const plan = slotPlan(slot);
    if (!flags['yes']) {
        fail(
            `this drops the database ${plan.database} and everything in it.\n` +
                `       Re-run with --yes if that is what you want.`
        );
    }

    const main = mainCheckout();
    const env = readEnv(join(main, '.env'));
    const psql = psqlRunner({
        url:
            env['DATABASE_URL'] ||
            'postgresql://ortha:ortha@localhost:5432/ortha_cms',
        container:
            typeof flags['container'] === 'string'
                ? flags['container']
                : DEFAULT_CONTAINER
    });

    if (!databaseExists(psql, plan.database)) {
        console.log(
            `- database ${plan.database} does not exist — nothing to do.`
        );
        return;
    }
    psql.run(`DROP DATABASE "${plan.database}" WITH (FORCE)`, 'postgres');
    console.log(`- database ${plan.database} dropped.`);
    console.log(
        `  The worktree and its .env are untouched — re-run \`provision ${slot} --force\` for a clean database.`
    );
}

function usage() {
    console.log(
        [
            'Parallel dev stack slots — one stack per git worktree.',
            '',
            'Usage:',
            '  node tools/worktree/slot.mjs provision <slot> [options]',
            '  node tools/worktree/slot.mjs list',
            '  node tools/worktree/slot.mjs release <slot> --yes',
            '',
            `A slot is 1–${MAX_SLOT}: API :300n, admin :420n, database ${BASE_DATABASE}_an.`,
            'Slot 0 is the main checkout and is managed by hand.',
            '',
            'provision options:',
            '  --path <dir>       the worktree to set up (default: cwd)',
            "  --from <file>      .env to copy (default: the main checkout's)",
            '  --force            overwrite an existing .env',
            '  --no-db            write the .env but do not create the database',
            `  --container <name> Postgres container (default: ${DEFAULT_CONTAINER})`,
            '',
            'See docs/parallel-stacks.md.'
        ].join('\n')
    );
}

const { positionals, flags } = parseArgs(process.argv.slice(2));
const command = positionals.shift();

switch (command) {
    case 'provision':
        provision({ positionals, flags });
        break;
    case 'list':
        await list();
        break;
    case 'release':
        release({ positionals, flags });
        break;
    case undefined:
    case 'help':
        usage();
        break;
    default:
        console.error(`slot: unknown command ${JSON.stringify(command)}\n`);
        usage();
        process.exit(1);
}
