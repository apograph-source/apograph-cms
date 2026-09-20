/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
    readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
    displayName: 'server',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    // Runs before any spec module is loaded, which is what it has to do: the
    // config module validates its environment at import time.
    setupFiles: ['<rootDir>/jest.setup.ts'],
    transform: {
        '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig]
    },
    // `jose` ships ESM only, and this project reaches it through
    // `plugins.ts` → `@orthacms/identity-provider-oidc`. Node 22 can
    // `require()` an ESM package, but Jest resolves through its own registry,
    // so without this exception every suite here dies at import time on a bare
    // `export {` inside jose. The negative lookahead keeps the rest of
    // `node_modules` untransformed.
    transformIgnorePatterns: ['/node_modules/(?!jose/)'],
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: 'test-output/jest/coverage'
};
