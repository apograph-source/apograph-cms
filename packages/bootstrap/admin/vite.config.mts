import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the admin host, mirroring `packages/utils/admin`.
//
// The dossier used to say this package has no test target of its own, on the
// grounds that a host is only meaningful with an app around it. That is true of
// everything `apps/admin-e2e` drives through a browser — and it left the host's
// own *diagnostics* unowned: the layout-collision and duplicate-path warnings,
// the named exception for a missing mount element, `<html lang>`/`dir`, and the
// once-per-id missing-translation report. Each of those is a decision
// `createAdmin` makes before or around the render, none is a page anyone can
// visit, and none was pinned anywhere.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/bootstrap/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/bootstrap-admin',
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
