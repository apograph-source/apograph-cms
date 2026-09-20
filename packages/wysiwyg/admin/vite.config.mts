import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config for the plugin's unit tests, mirroring `packages/segments/admin`.
//
// The editor's *behaviour* belongs in `admin-e2e`, which drives a real browser
// and a real ProseMirror view — a jsdom re-creation of typing, selection and
// clipboard would be a second, almost-right editor to keep in sync. What lives
// here is the half a browser cannot show cheaply or at all:
//
//   - the pure rules (`domain/`), which are functions and want to be called;
//   - the schema's *serialization* — what the stored body actually looks like —
//     which is the same code path the preview and the save both take;
//   - the structural claims (layering, the lazy boundary, the single style
//     scope), which are statements about the source tree rather than about a
//     running app, and are exactly what a browser test cannot see.
//
// `jsdom` rather than `node`: `transformPastedHTML` works on a `DOMParser`
// document, and TipTap's `DOMSerializer` needs a `document` to serialize into.
export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../../node_modules/.vite/packages/wysiwyg/admin',
    plugins: [react()],
    test: {
        name: '@orthacms/wysiwyg-admin',
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
