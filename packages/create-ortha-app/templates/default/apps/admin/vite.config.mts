import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    // This config lives inside the app it builds, so `root` is its own
    // directory rather than wherever the command was typed — the CLI runs
    // `vite --config apps/admin/vite.config.mts` from the project root.
    const root = import.meta.dirname;
    // The empty prefix is what makes unprefixed keys visible. Nothing here is
    // inlined into the client bundle — only `import.meta.env` and `define` are.
    // `.env` lives at the project root, two levels up from this config.
    const env = {
        ...loadEnv(mode, resolve(root, '../..'), ''),
        ...process.env
    };
    const adminPort = Number(env['ADMIN_PORT']) || 4200;
    const apiPort = Number(env['PORT']) || 3000;

    return {
        root,
        server: {
            port: adminPort,
            // Fail on a taken port rather than drifting to the next free one:
            // a silently-shifted port either 404s or lands on another app.
            strictPort: true,
            // Proxy the API under the admin's own origin, so the session
            // cookie (httpOnly, SameSite=lax) is first-party in development —
            // the same single origin `ortha start` gives you in production via
            // `staticDir`, and the reason neither needs CORS.
            //
            // The key is a REGEX ending in a slash, not the bare `/api`
            // prefix: a plain string key prefix-matches, so `/api` would also
            // swallow sibling SPA routes whose path merely starts with those
            // characters (`/api-tokens`) and forward them to the API, which
            // 404s them on a hard refresh.
            proxy: {
                '^/api/': {
                    target: `http://localhost:${apiPort}`,
                    changeOrigin: true
                }
            }
        },
        plugins: [tailwindcss(), react()],
        build: {
            // What `staticDir` serves in production — the shared `dist/` at
            // the project root, not one inside this app.
            outDir: resolve(root, '../../dist/admin'),
            emptyOutDir: true
        },
        // Unit tests for the **admin** half. Declared here rather than in a
        // `vitest.config.ts` of its own so the tests resolve modules exactly
        // the way the app does — same plugins, same aliases, no second config
        // to keep in step. The server half runs under Jest (`jest.config.js`),
        // which is what emits the decorator metadata NestJS DI needs.
        test: {
            name: 'admin',
            environment: 'jsdom',
            globals: true,
            include: ['src/**/*.{test,spec}.{ts,tsx}'],
            coverage: {
                reportsDirectory: resolve(root, '../../test-output/vitest')
            }
        }
    };
});
