/**
 * Unit tests for the **server** half.
 *
 * Jest with `@swc/jest`, not Vitest, and that is not a style choice: the server
 * is a NestJS app, its DI reads `emitDecoratorMetadata`, and Vitest's esbuild
 * transform does not emit it — providers resolve as `undefined` with no error
 * that names the cause. swc emits it, in the same legacy-decorator mode
 * `tsconfig.server.json` compiles with.
 *
 * The admin half runs under Vitest instead (see `apps/admin/vite.config.mts`), because it
 * is a Vite app and sharing its config is the only way the two agree on how
 * modules resolve. Two runners, one per half, each matching its own toolchain.
 */
module.exports = {
    displayName: 'server',
    testEnvironment: 'node',
    rootDir: '../..',
    testMatch: ['<rootDir>/apps/server/**/*.spec.ts'],
    setupFiles: ['<rootDir>/apps/server/jest.setup.js'],
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
    moduleFileExtensions: ['ts', 'js', 'json'],
    coverageDirectory: 'test-output/jest'
};
