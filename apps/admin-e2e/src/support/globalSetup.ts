import { request, type FullConfig } from '@playwright/test';

/**
 * Two preconditions this harness cannot verify from inside a test, checked once
 * before any spec runs — because both fail as a *broad, plausible-looking
 * regression* rather than as an environment problem, and both have cost this
 * project real time more than once.
 *
 * **1. Something else is on the port.** `webServer.reuseExistingServer` is
 * `true` unconditionally, which is right for the dev loop (a stack is usually
 * already up) and blind by construction: Playwright only probes that the URL
 * answers, never that it answers with *this* app. Point the port at any other
 * server and the whole suite fails on missing headings with nothing said about
 * why.
 *
 * **2. A real API is answering `/api`.** The specs mock `/api` with
 * `page.route` and need no backend at all. But a mock only covers the routes a
 * spec registered; anything else falls through the Vite proxy to whatever is
 * listening, which answers `401`, which trips the admin's global sign-out
 * interceptor — so `mockSignedIn` stops holding and nearly every page-level
 * spec fails on a redirect to `/identity/signin`. Measured during this project:
 * one spec file went 15 passed → 14 failed purely by starting the API. It looks
 * exactly like a regression and is not one.
 *
 * With nothing listening, the proxy answers `502 text/plain`. A real Nest API
 * answers JSON, which is the signal used below — status alone is ambiguous.
 */
export default async function assertHarnessPreconditions(
    config: FullConfig
): Promise<void> {
    const baseURL =
        config.projects[0]?.use?.baseURL ??
        `http://localhost:${Number(process.env['ADMIN_PORT']) || 4200}`;

    const api = await request.newContext({ baseURL });
    try {
        const index = await api.get('/');
        const html = index.ok() ? await index.text() : '';
        if (!html.includes('id="root"')) {
            throw new Error(
                `${baseURL} answered ${index.status()}, but it is not the Ortha admin ` +
                    `(no #root element in the served document).\n\n` +
                    `\`webServer.reuseExistingServer\` is true, so Playwright adopted whatever ` +
                    `was already listening on that port instead of starting the admin. Every ` +
                    `spec would now fail on a missing heading with no hint as to why.\n\n` +
                    `Free the port, or point ADMIN_PORT / BASE_URL at the right one.`
            );
        }

        const me = await api.get('/api/auth/me');
        const contentType = me.headers()['content-type'] ?? '';
        if (contentType.includes('application/json')) {
            throw new Error(
                `A real API is answering ${baseURL}/api/auth/me ` +
                    `(${me.status()}, ${contentType}).\n\n` +
                    `This suite mocks /api at the network layer and needs no backend. Any ` +
                    `request a spec has not mocked falls through the Vite proxy to that ` +
                    `server, whose 401 trips the admin's global sign-out interceptor — so ` +
                    `\`mockSignedIn\` stops working and nearly every page-level spec fails on ` +
                    `a redirect to /identity/signin. That looks like a broad regression and ` +
                    `is not one.\n\n` +
                    `Stop the API on that port and re-run.`
            );
        }
    } finally {
        await api.dispose();
    }
}
