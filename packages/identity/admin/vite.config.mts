import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests. Only the `domain/` value objects
// are covered today — they are framework-free, so they need none of this — but
// the React plugin and jsdom are here so a component test can be added without
// touching the harness, matching `packages/design-system`.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/identity/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/identity-admin',
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
