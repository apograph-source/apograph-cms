import { test, expect } from '../support/fixtures';
import {
    mockLogin,
    mockSignedIn,
    mockSignedOut,
    mockUnauthorized,
    spyLogout
} from '../support/api/auth';
import { mockMembers } from '../support/api/members';

const PASSWORD = 'SecurePass123!';

/**
 * Signing out (`useLogoutMutation`, driven from the sidebar account menu). That
 * the endpoint is called at all is the account-menu suite's job; this one pins
 * what happens to the tab around it — where the user ends up, and what the
 * outgoing session leaves behind in the query cache.
 */
test.describe('Logout', () => {
    test('lands the tab on the sign-in page', async ({
        page,
        loginPage,
        membersPage
    }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await spyLogout(page);
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        await membersPage.openAccountMenu();
        await membersPage.accountMenuItem('Logout').click();

        // Note `GET /auth/me` is still mocked as signed in: a successful logout
        // settles the gate on its own rather than asking the server again, so
        // the redirect can't depend on the probe answering 401.
        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
        await expect(membersPage.nav).toBeHidden();
    });

    test('says so when the request fails, instead of swallowing the click', async ({
        page,
        membersPage
    }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        // The request never reaches a server — what a user on a dropped
        // connection gets. The session was therefore *not* revoked.
        await page.route('**/api/auth/logout', (route) => route.abort());
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        await membersPage.openAccountMenu();
        await membersPage.accountMenuItem('Logout').click();

        await expect(page.getByText(/We couldn’t sign you out/)).toBeVisible();
        // And still signed in, truthfully: claiming otherwise would leave
        // someone on a shared machine believing they had left.
        await expect(page).toHaveURL(/\/users$/);
        await expect(membersPage.heading).toBeVisible();
    });

    test('leaves nothing of the previous account in the cache', async ({
        page,
        loginPage,
        membersPage
    }) => {
        await mockSignedIn(page, {
            id: 'u_ada',
            name: 'Ada Lovelace',
            email: 'ada@ortha.dev'
        });
        await mockMembers(page);
        await spyLogout(page);
        await membersPage.goto();
        await expect(membersPage.row('Ada Lovelace')).toBeVisible();

        await membersPage.openAccountMenu();
        await membersPage.accountMenuItem('Logout').click();
        // The gate stashes `/users` as the return target, so the next sign-in
        // comes back here in the *same page load* — a reload would wipe the
        // in-memory cache and prove nothing.
        await expect(loginPage.heading).toBeVisible();

        // Somebody else signs in on this tab, with the roster held open so only
        // cached rows could paint.
        await mockLogin(page, { status: 201 });
        await mockSignedIn(page, {
            id: 'u_grace',
            name: 'Grace Hopper',
            email: 'grace@ortha.dev'
        });
        await mockMembers(page, [], { delayMs: 30_000 });
        await loginPage.login('grace@ortha.dev', PASSWORD);

        await expect(page).toHaveURL(/\/users$/);
        await expect(membersPage.tableSkeleton()).toBeVisible();
        await expect(membersPage.row('Ada Lovelace')).toBeHidden();
    });
});

/**
 * The same invariant from the other end: a session can end without a logout —
 * revoked from another device, expired, the account suspended — and the tab is
 * bounced to sign-in by the shared `401` handler. Whoever signs in next must
 * not inherit what the previous account cached either.
 */
test.describe('Signing in after a session ended on its own', () => {
    test('does not inherit the previous account’s cached data', async ({
        page,
        loginPage,
        membersPage
    }) => {
        await mockSignedIn(page, {
            id: 'u_ada',
            name: 'Ada Lovelace',
            email: 'ada@ortha.dev'
        });
        await mockMembers(page);
        await membersPage.goto();
        await expect(membersPage.row('Ada Lovelace')).toBeVisible();

        await mockSignedOut(page);
        await mockUnauthorized(page, '**/api/users?*');
        await membersPage.search.fill('ada');
        await expect(loginPage.heading).toBeVisible();

        await mockLogin(page, { status: 201 });
        await mockSignedIn(page, {
            id: 'u_grace',
            name: 'Grace Hopper',
            email: 'grace@ortha.dev'
        });
        await mockMembers(page, [], { delayMs: 30_000 });
        await loginPage.login('grace@ortha.dev', PASSWORD);

        await expect(page).toHaveURL(/\/users$/);
        await expect(membersPage.tableSkeleton()).toBeVisible();
        await expect(membersPage.row('Ada Lovelace')).toBeHidden();
    });
});
