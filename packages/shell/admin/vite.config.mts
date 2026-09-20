import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the shell plugin, mirroring `packages/workspaces/admin`.
// The package had no test target at all until the invariant sweep: everything
// that pinned it lived in `apps/admin-e2e`, which cannot see the seams a
// browser has no handle on — the sidebar area's ownership token, the
// `useSidebarContent` factory+deps contract, the portal hosts staying mounted
// across a collapse, and a focus handoff nobody claimed expiring on the next
// tick. Those are what live here; page *behaviour* stays in `admin-e2e`.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/shell/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/shell-admin',
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
