import type { Page, Route } from '@playwright/test';

/** The API responses a run should answer with. */
export interface Seed {
    /** The signed-in user, or `null` for a signed-out session. */
    me?: unknown;
    /** Workspaces the sidebar lists. */
    workspaces?: unknown[];
    /** Anything else, keyed by path suffix — `'content/article'`. */
    routes?: Record<string, unknown>;
}

/**
 * Mocks `/api` at the network layer.
 *
 * The admin e2e suite drives the **UI**, not the stack: it runs against the
 * Vite dev server with no backend and no database, so a run is fast, hermetic,
 * and says something specific when it fails. Testing the API through a browser
 * would be slower and would blame the UI for server bugs — those belong in
 * `e2e/server`, where a failure names the endpoint.
 *
 * Anything not seeded gets a 404, deliberately: a silent empty `200` makes a
 * page render its empty state and pass, which is exactly the false green this
 * exists to avoid.
 */
export async function seedApi(page: Page, seed: Seed = {}): Promise<void> {
    const json = (route: Route, body: unknown, status = 200) =>
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body)
        });

    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(
            /^\/api\/?/,
            ''
        );

        if (path === 'auth/me') {
            return seed.me
                ? json(route, seed.me)
                : json(route, { message: 'Unauthorized' }, 401);
        }
        if (path === 'workspaces') {
            return json(route, { items: seed.workspaces ?? [], total: 0 });
        }

        const custom = seed.routes?.[path];
        if (custom !== undefined) return json(route, custom);

        return json(route, { message: `Unmocked: ${path}` }, 404);
    });
}

/** A signed-in session, for tests that start past the login screen. */
export const SIGNED_IN_USER = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'e2e@example.com',
    name: 'E2E User',
    permissions: []
};
