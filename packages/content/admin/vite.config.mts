import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring `packages/users/admin`.
// Component *behaviour* belongs in `admin-e2e`, which drives a real browser;
// what lives here is the handful of invariants a browser can't reach cheaply —
// currently the saved-view payload rules (capture/dirty/reconcile), whose whole
// job is to compare states the UI can only reach one keystroke at a time.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/content/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/content-admin',
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
