import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the media plugin's unit tests, mirroring
// `packages/shell/admin`. The package had no test target at all until the
// invariant sweep: everything that pinned it lived in `apps/admin-e2e`, which
// drives a real browser and is the right home for page *behaviour* — but which
// cannot cheaply see the seams behind the pixels. Those are what live here: the
// library store's control → selection → page algebra, and the TanStack cache
// keys, whose whole job is to keep one workspace's listing out of another's.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/media/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/media-admin',
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
