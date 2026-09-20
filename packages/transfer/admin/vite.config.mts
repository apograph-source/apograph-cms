import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the transfer plugin's unit tests, mirroring
// `packages/media/admin`. The package had no test target at all until the
// invariant sweep. Dialog *behaviour* belongs in `apps/admin-e2e`, and is
// already there; what a browser cannot see is which caches an apply refreshes —
// `invalidateQueries` only refetches queries that are currently mounted, and
// the import dialog is reachable only from the collection you are already
// looking at, so every other list is unmounted by construction.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/transfer/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/transfer-admin',
        watch: false,
        globals: true,
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        reporters: ['default'],
        coverage: {
            reportsDirectory: './test-output/vitest/coverage',
            provider: 'v8' as const
        }
    }
}));
