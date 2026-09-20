import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import type { HostConfig } from '../project';

/**
 * One ordered log across every collaborator, because what these five commands
 * are for is *sequence*: build before reading the compiled config, build before
 * watching `dist/`, and — for `generate` — never touching either.
 */
const calls: string[] = [];

const buildCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('build');
});
const loadHost = jest.fn((...args: unknown[]) => {
    void args;
    calls.push('loadHost');

    return { config: hostConfig, plugins: PLUGINS };
});
const applyPluginMigrations = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('applyPluginMigrations');
});
const runDrizzleKitStudio = jest.fn((...args: unknown[]) => {
    void args;
    calls.push('runDrizzleKitStudio');
});
const runDrizzleKitGenerate = jest.fn((...args: unknown[]) => {
    void args;
    calls.push('runDrizzleKitGenerate');
});
const spawnNode = jest.fn((...args: unknown[]) => {
    calls.push(`spawn ${(args[0] as string[]).join(' ')}`);

    return { pid: 1 };
});
const superviseUntilExit = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('supervise');
});
const run = jest.fn(async (...args: unknown[]) => {
    calls.push(`run ${(args[0] as string[]).join(' ')}`);
});

jest.mock('./build', () => ({
    buildCommand: (...args: unknown[]) => buildCommand(...args)
}));
jest.mock('../project', () => ({
    ...jest.requireActual('../project'),
    loadHost: (...args: unknown[]) => loadHost(...args)
}));
jest.mock('../migrate', () => ({
    applyPluginMigrations: (...args: unknown[]) =>
        applyPluginMigrations(...args)
}));
jest.mock('../studio', () => ({
    runDrizzleKitStudio: (...args: unknown[]) => runDrizzleKitStudio(...args)
}));
jest.mock('../generate', () => ({
    runDrizzleKitGenerate: (...args: unknown[]) =>
        runDrizzleKitGenerate(...args)
}));
jest.mock('../run', () => ({
    spawnNode: (...args: unknown[]) => spawnNode(...args),
    superviseUntilExit: (...args: unknown[]) => superviseUntilExit(...args),
    run: (...args: unknown[]) => run(...args),
    tscBin: (root: string) => join(root, 'node_modules/typescript/bin/tsc'),
    viteBin: (root: string) => join(root, 'node_modules/vite/bin/vite.js')
}));

import { LAYOUT } from '../project';
import { devCommand } from './dev';
import { generateCommand } from './generate';
import { migrateCommand } from './migrate';
import { startCommand } from './start';
import { studioCommand } from './studio';

const URL = 'postgresql://ortha:secret@db:5432/app';
const PLUGINS = [
    { name: 'database' },
    { name: 'identity' }
] as unknown as ServerPlugin[];

/** What the mocked `loadHost` answers; a test may narrow it. */
let hostConfig: HostConfig = { database: { url: URL } };

const roots: string[] = [];

/** An app tree, with whichever of the four convention paths a test needs. */
function tempApp(
    present: Partial<
        Record<'adminIndex' | 'serverEntry' | 'drizzleConfig', boolean>
    > = {}
): string {
    const root = mkdtempSync(join(tmpdir(), 'ortha-cli-commands-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"name":"my-cms"}', 'utf8');

    for (const [key, exists] of Object.entries(present)) {
        if (!exists) continue;
        const path = join(root, LAYOUT[key as keyof typeof LAYOUT]);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, '// fixture', 'utf8');
    }

    return root;
}

beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    hostConfig = { database: { url: URL } };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('devCommand', () => {
    /**
     * The one-shot build first is load-bearing, not tidiness. `node --watch`
     * **cannot recover from a missing entry point** — handed a path that does
     * not exist yet it stays alive watching nothing and never boots, which
     * reads as a server that hung rather than one started a second too early.
     * So the ordering here is the whole fix, and asserting the two calls
     * happened is not enough: it has to be this order.
     */
    it('builds dist/ once, before node --watch [cli:I-16]', async () => {
        const root = tempApp({ adminIndex: true });

        await devCommand(root);

        expect(buildCommand).toHaveBeenCalledTimes(1);
        expect(buildCommand).toHaveBeenCalledWith(root, { serverOnly: true });
        expect(calls[0]).toBe('build');
        expect(calls).toContain(
            `spawn --watch ${join(root, LAYOUT.serverEntry)}`
        );
        expect(calls.indexOf('build')).toBeLessThan(
            calls.findIndex((call) => call.startsWith('spawn --watch'))
        );
    });

    it('watches the server’s tsconfig without clearing the shared terminal [cli:I-16]', async () => {
        const root = tempApp();

        await devCommand(root);

        expect(spawnNode).toHaveBeenCalledWith(
            [
                join(root, 'node_modules/typescript/bin/tsc'),
                '-p',
                LAYOUT.serverTsconfig,
                '--watch',
                '--preserveWatchOutput'
            ],
            root
        );
    });

    /**
     * The half-stack flags. The monorepo runs either half on its own
     * (`start:server` / `start:admin`), and these are the generated app's
     * version of that — the API alone while the admin is served from
     * somewhere else, or the admin alone against an API already up.
     *
     * Until this was implemented `devCommand` took no options at all, so
     * `ortha dev --server` started Vite exactly as if the flag had not been
     * typed.
     */
    describe('one half at a time', () => {
        it('starts no Vite for --server, even with an admin present', async () => {
            const root = tempApp({ adminIndex: true });

            await devCommand(root, { serverOnly: true, adminOnly: false });

            expect(spawnNode).toHaveBeenCalledTimes(2);
            expect(calls.filter((call) => call.includes('vite'))).toEqual([]);
        });

        /**
         * And no `tsc`, no `node --watch` and no build: `--admin` is for an
         * API that is already running, so compiling over its `dist/` while it
         * watches would restart someone else's server.
         */
        it('compiles nothing and watches nothing for --admin', async () => {
            const root = tempApp({ adminIndex: true });

            await devCommand(root, { serverOnly: false, adminOnly: true });

            expect(buildCommand).not.toHaveBeenCalled();
            expect(spawnNode).toHaveBeenCalledTimes(1);
            expect(calls[0]).toContain('vite');
        });

        /**
         * The one case where supervising an empty set would exit 0 with no
         * output — a command that appears to have run and did nothing at all.
         */
        it('says so when --admin is asked of an app that has no admin', async () => {
            const root = tempApp();

            await expect(
                devCommand(root, { serverOnly: false, adminOnly: true })
            ).rejects.toThrow(/no admin to run/);

            expect(spawnNode).not.toHaveBeenCalled();
            expect(superviseUntilExit).not.toHaveBeenCalled();
        });
    });

    it('starts Vite only when the app has an admin', async () => {
        const withAdmin = tempApp({ adminIndex: true });
        await devCommand(withAdmin);
        expect(spawnNode).toHaveBeenCalledTimes(3);

        calls.length = 0;
        jest.clearAllMocks();
        await devCommand(tempApp());
        expect(spawnNode).toHaveBeenCalledTimes(2);
    });

    it('supervises every child it started, once they are all up', async () => {
        const root = tempApp({ adminIndex: true });

        await devCommand(root);

        expect(calls[calls.length - 1]).toBe('supervise');
        expect(superviseUntilExit.mock.calls[0][0] as unknown[]).toHaveLength(
            3
        );
    });
});

describe('migrateCommand', () => {
    /**
     * Migrating is the one command whose input is the app's *own* TypeScript —
     * the plugin list, and the order it is in. A stale `dist/` would silently
     * migrate against the previous composition: a plugin added an hour ago
     * simply would not have its tables created, and nothing would say so.
     */
    it('builds the server before reading the compiled config [cli:I-02]', async () => {
        await migrateCommand(tempApp());

        expect(calls).toEqual(['build', 'loadHost', 'applyPluginMigrations']);
        expect(buildCommand).toHaveBeenCalledWith(expect.any(String), {
            serverOnly: true
        });
    });

    /**
     * The generated-app half of "one implementation for two worlds": this
     * command reaches the same `applyPluginMigrations` the Nx executor adapts,
     * with the host's own plugin list and the configured URL.
     */
    it('applies the host’s plugins through the shared implementation [cli:I-01]', async () => {
        await migrateCommand(tempApp());

        expect(applyPluginMigrations).toHaveBeenCalledWith(PLUGINS, URL);
    });

    it('refuses an unset DATABASE_URL before opening anything [cli:I-03]', async () => {
        hostConfig = {};

        await expect(migrateCommand(tempApp())).rejects.toThrow(
            /DATABASE_URL is not set/
        );
        expect(applyPluginMigrations).not.toHaveBeenCalled();
    });
});

describe('studioCommand', () => {
    it('builds the server before reading the compiled config [cli:I-02]', async () => {
        await studioCommand(tempApp(), {});

        expect(calls).toEqual(['build', 'loadHost', 'runDrizzleKitStudio']);
        expect(buildCommand).toHaveBeenCalledWith(expect.any(String), {
            serverOnly: true
        });
    });

    it('opens Studio on the configured database, with the bind the user asked for', async () => {
        await studioCommand(tempApp(), { host: '0.0.0.0', port: 5000 });

        expect(runDrizzleKitStudio).toHaveBeenCalledWith(URL, {
            host: '0.0.0.0',
            port: 5000
        });
    });

    it('refuses an unset DATABASE_URL rather than introspecting a default one [cli:I-03]', async () => {
        hostConfig = { database: { url: '' } };

        await expect(studioCommand(tempApp(), {})).rejects.toThrow(
            /DATABASE_URL is not set/
        );
        expect(runDrizzleKitStudio).not.toHaveBeenCalled();
    });
});

describe('generateCommand', () => {
    /**
     * Generation only diffs the schema against the stored snapshot. It never
     * connects, which is precisely why the committed drizzle configs carry no
     * credentials — so this command must not be the thing that acquires one:
     * it neither loads the host's config nor resolves a database URL, and the
     * argv it hands drizzle-kit mentions no connection.
     */
    it('never reaches for a database [cli:I-20]', () => {
        const root = tempApp({ drizzleConfig: true });

        generateCommand(root, 'add_posts');

        expect(loadHost).not.toHaveBeenCalled();
        expect(buildCommand).not.toHaveBeenCalled();
        expect(runDrizzleKitGenerate).toHaveBeenCalledWith(
            root,
            LAYOUT.drizzleConfig,
            'add_posts'
        );
        expect(JSON.stringify(runDrizzleKitGenerate.mock.calls)).not.toMatch(
            /postgres|DATABASE_URL|password/i
        );
    });

    it('says what a drizzle.config.ts is for when the app has none', () => {
        const root = tempApp();

        expect(() => generateCommand(root)).toThrow(
            new RegExp(
                `No ${LAYOUT.drizzleConfig.replace(/\./g, '\\.')} in ${root}`
            )
        );
        expect(runDrizzleKitGenerate).not.toHaveBeenCalled();
    });
});

describe('startCommand', () => {
    it('runs the compiled entry point', async () => {
        const root = tempApp({ serverEntry: true });

        await startCommand(root);

        expect(run).toHaveBeenCalledWith(
            [join(root, LAYOUT.serverEntry)],
            root
        );
    });

    /**
     * A missing entry point is an unbuilt app, not a broken one — and saying
     * which is the difference between a one-line fix and a hunt.
     */
    it('names the build step when dist/ is not there yet', async () => {
        const root = tempApp();

        await expect(startCommand(root)).rejects.toThrow(
            `${LAYOUT.serverEntry} does not exist — run \`ortha build\` first.`
        );
        expect(run).not.toHaveBeenCalled();
    });
});
