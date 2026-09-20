import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateNodesContextV2 } from '@nx/devkit';
import { createNodesV2 } from './index';

const [glob, createNodes] = createNodesV2;

/** A throwaway workspace root, so the manifest guards can be exercised on disk. */
let workspaceRoot: string;

beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ortha-nx-infer-'));
});

afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
});

/** Writes a file (and its parents) under the fake workspace root. */
function write(relativePath: string, contents: string): void {
    const absolute = join(workspaceRoot, relativePath);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
}

async function infer(...files: string[]) {
    const results = await createNodes(files, {}, {
        workspaceRoot
    } as CreateNodesContextV2);

    return Object.fromEntries(
        results.map(([file, result]) => [
            file,
            Object.values(
                (result as { projects?: Record<string, { targets: unknown }> })
                    .projects ?? {}
            )[0]?.targets ?? {}
        ])
    ) as Record<string, Record<string, Record<string, unknown>>>;
}

describe('createNodesV2 glob', () => {
    it('matches the three config files inference dispatches on [nx:I-01]', () => {
        expect(glob).toBe(
            '**/{drizzle.config.ts,ortha.config.ts,package.json}'
        );
    });
});

describe('db:generate inference', () => {
    it('attaches to any project with a drizzle.config.ts, with a cwd-relative config [nx:I-02]', async () => {
        const targets = await infer('packages/media/server/drizzle.config.ts');

        expect(targets['packages/media/server/drizzle.config.ts']).toEqual({
            'db:generate': {
                executor: '@orthacms/nx:db-generate',
                options: {
                    cwd: 'packages/media/server',
                    config: 'drizzle.config.ts'
                },
                cache: false
            }
        });
    });

    /**
     * Regression: `db:generate` used to be cached against
     * `{projectRoot}/src/lib/schema/**\/*`, a path five of this workspace's
     * eight drizzle configs do not use. The input matched nothing for them, so
     * editing the schema did not change the hash and re-running with the same
     * `--name` replayed a cached "No schema changes, nothing to migrate" — no
     * migration, and a green tick. Worse, the cached `migrations/` directory
     * was restored as an output, deleting migrations generated since.
     *
     * There is no input glob that fixes this: drizzle-kit diffs against
     * `migrations/meta/*_snapshot.json`, which lives inside the declared
     * output. So the target must not be cached at all.
     */
    it('is never cached, and declares no inputs or outputs to be cached against [nx:I-04]', async () => {
        const targets = await infer('packages/media/server/drizzle.config.ts');
        const generate =
            targets['packages/media/server/drizzle.config.ts']['db:generate'];

        expect(generate['cache']).toBe(false);
        expect(generate).not.toHaveProperty('inputs');
        expect(generate).not.toHaveProperty('outputs');
    });

    it('does not attach db:migrate or db:studio [nx:I-02]', async () => {
        const targets = await infer('packages/media/server/drizzle.config.ts');

        expect(
            Object.keys(targets['packages/media/server/drizzle.config.ts'])
        ).toEqual(['db:generate']);
    });
});

describe('db:migrate / db:studio inference', () => {
    it('attaches both to the project owning ortha.config.ts, uncached [nx:I-03]', async () => {
        const targets = await infer('apps/server/ortha.config.ts');

        expect(targets['apps/server/ortha.config.ts']).toEqual({
            'db:migrate': {
                executor: '@orthacms/nx:db-migrate',
                options: {
                    config: 'apps/server/ortha.config.ts',
                    plugins: 'apps/server/src/plugins.ts'
                },
                cache: false
            },
            'db:studio': {
                executor: '@orthacms/nx:db-studio',
                options: { config: 'apps/server/ortha.config.ts' },
                cache: false
            }
        });
    });
});

describe('packages/* build, pack and publish inference', () => {
    function stagePackage(
        root: string,
        manifest: Record<string, unknown>,
        options: { tsconfig?: boolean } = {}
    ): string {
        write(`${root}/package.json`, JSON.stringify(manifest));
        if (options.tsconfig !== false) {
            write(`${root}/tsconfig.lib.json`, '{}');
        }
        return `${root}/package.json`;
    }

    it('gives a publishable package build, pack and a redirected nx-release-publish [nx:I-15] [nx:I-18] [nx:I-19]', async () => {
        const file = stagePackage('packages/utils/admin', {
            name: '@orthacms/utils-admin'
        });

        const targets = (await infer(file))[file];

        expect(Object.keys(targets).sort()).toEqual([
            'build',
            'nx-release-publish',
            'pack'
        ]);
        expect(targets['build']['options']).toEqual({
            command: 'tsc --build tsconfig.lib.json --pretty',
            cwd: 'packages/utils/admin'
        });
        expect(targets['pack']['cache']).toBe(false);
        expect(targets['nx-release-publish']).toEqual({
            executor: '@orthacms/nx:release-publish',
            options: { packageRoot: 'dist/pack/packages/utils/admin' }
        });
    });

    it('names the same executor nx.json’s targetDefaults does [nx:I-18]', async () => {
        // The clause the test above cannot reach. `nx-release-publish` is
        // declared **twice** — here and in `nx.json`'s `targetDefaults` — and
        // Nx adds an implicit one of its own to every non-private package,
        // applied *after* inference. When the two declarations disagree, Nx's
        // wins outright and takes `packageRoot` with it, so the release quietly
        // publishes the source-pointing project root instead of what `pack`
        // staged: a tarball whose `exports` point at `./src/index.ts`, which
        // installs and then fails to resolve for every consumer.
        //
        // Nothing about that is visible from inside either declaration, so this
        // reads the real `nx.json` rather than a fixture — the disagreement is
        // between two files, and only one of them is this package's.
        const nxJson = JSON.parse(
            readFileSync(join(__dirname, '../../../nx.json'), 'utf8')
        ) as { targetDefaults: Record<string, { executor?: string }> };

        const file = stagePackage('packages/utils/admin', {
            name: '@orthacms/utils-admin'
        });
        const inferred = (await infer(file))[file]['nx-release-publish'];

        expect(nxJson.targetDefaults['nx-release-publish'].executor).toBe(
            '@orthacms/nx:release-publish'
        );
        expect(inferred['executor']).toBe(
            nxJson.targetDefaults['nx-release-publish'].executor
        );
        // `dependsOn` lives in `targetDefaults` alone, for the same reason:
        // Nx would overwrite an inferred one. Declaring it here too is how the
        // two drift apart.
        expect(inferred).not.toHaveProperty('dependsOn');
        expect(nxJson.targetDefaults['nx-release-publish']).toHaveProperty(
            'dependsOn',
            ['pack']
        );
    });

    it('gives a private package build only — workspace tooling is not a distributable [nx:I-17]', async () => {
        const file = stagePackage('packages/nx', {
            name: '@orthacms/nx',
            private: true
        });

        expect(Object.keys((await infer(file))[file])).toEqual(['build']);
    });

    it.each([
        [
            'a manifest outside packages/',
            (): string =>
                stagePackage('apps/admin', { name: '@orthacms/admin' })
        ],
        [
            'the workspace-root manifest',
            (): string => stagePackage('.', { name: 'ortha-cms' })
        ],
        [
            'a manifest with no name',
            (): string => stagePackage('packages/anon', { version: '1.0.0' })
        ],
        [
            'a package with no tsconfig.lib.json',
            (): string =>
                stagePackage(
                    'packages/nolib',
                    { name: '@orthacms/nolib' },
                    { tsconfig: false }
                )
        ]
        // covers: nx:I-15
    ])('contributes no targets for %s', async (_label, stage) => {
        const file = stage();

        expect((await infer(file))[file]).toEqual({});
    });

    it('contributes no targets for an unparseable manifest, rather than failing the graph [nx:I-16]', async () => {
        write('packages/broken/package.json', '{ not json');
        write('packages/broken/tsconfig.lib.json', '{}');

        await expect(infer('packages/broken/package.json')).resolves.toEqual({
            'packages/broken/package.json': {}
        });
    });
});
