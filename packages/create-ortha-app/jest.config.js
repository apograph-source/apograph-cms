const { readFileSync } = require('fs');
const { join } = require('path');

const swcJestConfig = JSON.parse(
    readFileSync(join(__dirname, '.spec.swcrc'), 'utf-8')
);
swcJestConfig.swcrc = false;

module.exports = {
    displayName: 'create-ortha-app',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig]
    },
    moduleFileExtensions: ['ts', 'js'],
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    coverageDirectory: 'test-output/jest/coverage'
};
