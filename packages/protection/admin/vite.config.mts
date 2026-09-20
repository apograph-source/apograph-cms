import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring `packages/users/admin`.
// Component *behaviour* belongs in `admin-e2e`, which drives a real browser;
// what lives here is the one invariant a browser cannot reach cheaply — the
// three-state control's state algebra, whose whole job is to make "a segment in
// both lists" unreachable.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/protection/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/protection-admin',
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
