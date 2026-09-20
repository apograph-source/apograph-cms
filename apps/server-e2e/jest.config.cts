import { readFileSync } from 'fs';

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
    readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

export default {
    displayName: 'server-e2e',
    preset: '../../jest.preset.js',
    globalSetup: '<rootDir>/src/support/global-setup.ts',
    globalTeardown: '<rootDir>/src/support/global-teardown.ts',
    // Per-test harness state that lives in memory rather than in the database,
    // and so is not reached by `resetDb`.
    setupFilesAfterEnv: ['<rootDir>/src/support/jest.setup.ts'],
    testEnvironment: 'node',
    // Key matches the Nx preset's transform pattern **exactly**, so this
    // overrides it rather than sitting alongside it. Otherwise the preset's
    // `ts-jest` entry stays in the map and claims the `@scalar` files below,
    // then dies looking for a `tsconfig.spec.json` this project doesn't have.
    transform: {
        '^.+\\.(ts|js|mts|mjs|cts|cjs)$': ['@swc/jest', swcJestConfig]
    },
    // `@scalar/*` ships ESM only, and the harness reaches it through
    // `bootstrap-server` → `setup-api-docs` → `@scalar/nestjs-api-reference`.
    // Jest ignores `node_modules` for transforms by default, so without this
    // exception every suite dies at import time on a bare `export {`. The
    // negative lookahead keeps the rest of `node_modules` untransformed.
    //
    // `jose` joins it for the same reason, reached through
    // `@orthacms/identity-provider-oidc` in the host's `buildPlugins`.
    transformIgnorePatterns: ['/node_modules/(?!(@scalar|jose)/)'],
    // Workspace packages are consumed from source; map the entry points the
    // harness (and `buildPlugins`) pull in to their `src/index.ts`.
    moduleNameMapper: {
        '^@orthacms/bootstrap-server$':
            '<rootDir>/../../packages/bootstrap/server/src/index.ts',
        '^@orthacms/database$':
            '<rootDir>/../../packages/database/src/index.ts',
        '^@orthacms/identity-server$':
            '<rootDir>/../../packages/identity/server/src/index.ts',
        // Mapped for the same reason as identity-server above: `support/
        // webhooks.ts` reaches two of the plugin's providers by path (they are
        // bound for DI but not re-exported), and `app.get(X)` only returns a
        // provider if the class the harness holds is the class the module
        // registered. Both sides must resolve into `packages/`, rather than one
        // through the `node_modules` symlink and one through the tree.
        '^@orthacms/webhooks-server$':
            '<rootDir>/../../packages/webhooks/server/src/index.ts'
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: 'test-output/jest/coverage',
    // Booting Nest + bcrypt seeding exceeds Jest's 5s default on cold CI.
    testTimeout: 30000,
    // One shared testcontainer; serial suites avoid racing on `resetDb`.
    // Parallelism can come later via a DB-per-worker scheme.
    //
    // Load-bearing, and **enforced** in `global-setup` rather than merely set
    // here: a CLI `--maxWorkers` overrides this file, and the corruption that
    // follows presents as unique-constraint violations inside unrelated tests.
    maxWorkers: 1
    // `maxWorkers: 1` also decides *where* the specs run, which is not obvious
    // and is what the memory story below turns on. Jest's `shouldRunInBand`
    // returns true on `maxWorkers <= 1`, so this suite runs **in band** — every
    // spec file executes in the task process itself, not in a forked worker.
    // One long-lived process for all ~94 files, and nothing recycles it.
    //
    // Its heap therefore climbs monotonically: 1.3 GB at 12 minutes, 2.0 GB at
    // 25, each file booting its own Nest app in its own module registry. Node's
    // default old-space ceiling is sized from total RAM — 2.2 GB on an 8 GB
    // machine — so a full run hits it around minute 20 and dies with
    // "Ineffective mark-compacts near heap limit", blamed on whichever suite was
    // running. **The ceiling is raised in `.env.e2e`**, which Nx loads for this
    // target; `global-setup` warns if a run somehow starts without it.
    //
    // NOT set: `workerIdleMemoryLimit`. It looks like the fix and is not, for a
    // reason the same line of Jest source explains: setting it is precisely what
    // *disables* in-band execution (`workerIdleMemoryLimit === undefined &&
    // (oneWorkerOrLess || …)`). So it does not "recycle the worker" — it forks
    // one that did not exist before, then restarts it whenever RSS crosses the
    // limit, each restart discarding the whole `node_modules` require cache.
    // Measured on the machine that has the problem: 1894 s against 1030 s for
    // the same suite, with RSS held near 500 MB. A ceiling is the cheap lever;
    // this is not. The growth itself is still worth fixing at the source.
};
