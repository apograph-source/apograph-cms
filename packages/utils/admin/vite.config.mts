import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the shared admin leaf, mirroring `packages/users/admin`.
// Every admin plugin inherits this package's behaviour, so the seams that would
// otherwise only be observable through a consumer — the 401 exemption match,
// the query retry predicate, the URL/search round trip and the unsaved-changes
// guard — are pinned here rather than in whichever page happened to notice.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/utils/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/utils-admin',
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
