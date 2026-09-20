import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring
// `packages/users/admin`. This package had none at all, which is why seven of
// the feature's invariants — the ones about a plaintext secret leaving no
// trace, about no dismissal discarding an uncopied one, and about the page
// failing closed — had nowhere to be asserted except a browser. Component
// *behaviour* still belongs in `admin-e2e`; what lives here is the logic a
// browser reaches only indirectly: the wire→view mapper's status derivation,
// the page-number parser, and the dialog's close guard.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/api-tokens/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/api-tokens-admin',
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
