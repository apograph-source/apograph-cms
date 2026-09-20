import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring
// `packages/workspaces/admin`. This package used to run its two pure specs
// under jest in the `node` environment, on the reasoning that component
// behaviour belongs in `admin-e2e`. It still does — but a handful of this
// frame's invariants are precisely the ones a browser cannot reach: a widget
// that throws during render (no contributed widget can be made to throw
// through the e2e mock layer, which only shapes HTTP responses), the boundary
// forgetting that throw when the range changes, the fallback a hook gives
// outside its provider, and the span a typo'd `size` resolves to. Those need a
// renderer, so the runner is the same jsdom vitest the other admin plugins use.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/insights/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/insights-admin',
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
