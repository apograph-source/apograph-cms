/**
 * Server end-to-end tests — the real app, a real database.
 *
 * Separate from `jest.config.js` on purpose: these need a database, take
 * seconds rather than milliseconds, and must run **serially**. `npm test`
 * stays fast and infrastructure-free; `npm run e2e:server` is the slow one you
 * run before pushing.
 */
module.exports = {
    displayName: 'server-e2e',
    testEnvironment: 'node',
    rootDir: '../..',
    testMatch: ['<rootDir>/apps/server-e2e/src/**/*.spec.ts'],
    globalSetup: '<rootDir>/apps/server-e2e/src/global-setup.ts',
    setupFiles: ['<rootDir>/apps/server-e2e/src/jest.setup.ts'],
    // One worker. The suite truncates shared tables, so parallel workers
    // delete each other's fixtures — and the failure surfaces as whichever
    // assertion happened to read a row mid-truncate, never as the race it is.
    maxWorkers: 1,
    // Booting the app migrates nothing but does open a pool and run the
    // bootstrap seeders; the default 5s is not enough on a cold database.
    testTimeout: 30_000,
    transform: {
        '^.+\\.[tj]s$': [
            '@swc/jest',
            {
                jsc: {
                    target: 'es2022',
                    parser: { syntax: 'typescript', decorators: true },
                    transform: {
                        legacyDecorator: true,
                        decoratorMetadata: true
                    }
                },
                module: { type: 'commonjs' }
            }
        ]
    },
    // Jest runs CommonJS, and `createServer` pulls in the Scalar API-reference
    // renderer, which is published as ESM only — so `node_modules` cannot be
    // ignored wholesale or the import fails with `Unexpected token 'export'`
    // pointing at a file nobody in this app wrote. Letting swc transform that
    // one scope is cheaper than stubbing the module and pretending the docs
    // route does not exist.
    transformIgnorePatterns: ['/node_modules/(?!@scalar/)'],
    moduleFileExtensions: ['ts', 'js', 'json']
};
