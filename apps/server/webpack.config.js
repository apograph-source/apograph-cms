const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const nodeExternals = require('webpack-node-externals');
const { join } = require('path');

module.exports = {
    // Workspace packages must be **bundled**, everything else externalized.
    //
    // `@orthacms/*` is consumed from source — the manifests' `exports` point
    // at `./src/index.ts` — so a `require('@orthacms/bootstrap-server')` left
    // in the output makes `node dist/main.js` load raw TypeScript and die on
    // `ERR_MODULE_NOT_FOUND` (Node strips types but does not do TS module
    // resolution, so the extensionless `./lib/create-server` inside it fails).
    //
    // Nx's own externals do this by allowlisting *non-buildable* libs, and it
    // recognises a source-pointing `exports` map as non-buildable — but it
    // short-circuits on "does the project have a `build` target?" first, and
    // `@orthacms/nx` infers one onto every `packages/*` project for the
    // release. So every workspace package lands on the externalized side.
    // Hence our own list, with `externalDependencies: 'none'` below telling Nx
    // not to append its own, and `mergeExternals` telling it to keep ours.
    externals: [
        nodeExternals({
            modulesDir: join(__dirname, '../../node_modules'),
            allowlist: [/^@orthacms\//]
        })
    ],
    output: {
        path: join(__dirname, 'dist'),
        // `dev:build` (watch) runs alongside `dev:run`, which holds
        // `node --watch` on dist/main.js. Cleaning on the watcher's first
        // compile would delete that file out from under the runner — and
        // `node --watch` cannot recover from a missing entry point, it just
        // hangs. `dev:prebuild` still cleans, so dist is never stale.
        clean: process.env.NX_WATCH_BUILD !== 'true',
        ...(process.env.NODE_ENV !== 'production' && {
            devtoolModuleFilenameTemplate: '[absolute-resource-path]'
        })
    },
    plugins: [
        new NxAppWebpackPlugin({
            target: 'node',
            compiler: 'tsc',
            main: './src/main.ts',
            tsConfig: './tsconfig.app.json',
            assets: ['./src/assets'],
            optimization: false,
            outputHashing: 'none',
            generatePackageJson: false,
            sourceMap: true,
            externalDependencies: 'none',
            mergeExternals: true
        })
    ]
};
