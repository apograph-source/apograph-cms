import { expect, test } from '@playwright/test';
import { seedApi, SIGNED_IN_USER } from './support/seed';

/**
 * The admin, driven in a browser against a mocked API.
 *
 * These assert what only a browser can see — that a route renders, that the
 * gate holds, that the shell mounts. Anything about *what the API returns*
 * belongs in `e2e/server`.
 */
test.describe('the admin shell', () => {
    test('sends a signed-out visitor to sign in', async ({ page }) => {
        await seedApi(page);

        await page.goto('/');

        await expect(
            page.getByRole('textbox', { name: /email/i })
        ).toBeVisible();
    });

    test('keeps a signed-out visitor off a private route', async ({ page }) => {
        await seedApi(page);

        // The gate is the shell's layout composing identity's `RequireAuth`.
        // If a second plugin ever contributes a layout ahead of the shell's,
        // this is the test that notices — the page renders, ungated.
        await page.goto('/workspaces');

        await expect(
            page.getByRole('textbox', { name: /email/i })
        ).toBeVisible();
    });

    test('renders the app shell for a signed-in user', async ({ page }) => {
        await seedApi(page, { me: SIGNED_IN_USER, workspaces: [] });

        await page.goto('/workspaces');

        // The `<main>` landmark comes from the shell's layout — its presence is
        // what says the chrome mounted rather than a bare route.
        await expect(page.getByRole('main')).toBeVisible();
    });

    test('serves a deep route on a hard refresh', async ({ page }) => {
        await seedApi(page, { me: SIGNED_IN_USER, workspaces: [] });

        // A client-side route reached by URL rather than by clicking. In
        // production this is the SPA fallback's job; in dev it is Vite's.
        // Either way a 404 here means the app is unreachable on refresh.
        const response = await page.goto('/workspaces/settings');

        expect(response?.status()).toBeLessThan(400);
    });
});
