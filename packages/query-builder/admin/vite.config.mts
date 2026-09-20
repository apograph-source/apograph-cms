import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the package's unit tests, mirroring `packages/segments/admin`.
// Component *behaviour* belongs in `admin-e2e`, which drives a real browser;
// what lives here is what a browser cannot reach cheaply — the pure tree the
// field picker is built from, whose whole job is deciding which of three
// buckets a field belongs in.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/query-builder/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/query-builder-admin',
        watch: false,
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test-setup.ts'],
        include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        reporters: ['default'],
        coverage: {
            reportsDirectory: './test-output/vitest/coverage',
            provider: 'v8' as const
        }
    }
}));
