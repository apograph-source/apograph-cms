import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring
// `packages/workspaces/admin`. Component *behaviour* belongs in `admin-e2e`,
// which drives a real browser — what lives here is the handful of invariants a
// browser can't reach: the wire→view mapper's coercion rules and the client
// entity's guardrail matrix, both of which need inputs the API won't produce on
// demand (a custom role key, a member who is simultaneously you and the last
// admin).
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/users/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/users-admin',
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
