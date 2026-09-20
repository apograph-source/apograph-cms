import { test, expect } from '../support/fixtures';
import { mockSignedIn, spyLogout } from '../support/api/auth';
import { mockMembers } from '../support/api/members';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    mockEmptyActivity,
    mockUserDetail,
    mockUserSessions
} from '../support/api/userDetail';

/**
 * The toolbar account menu (`AccountMenu`, `@orthacms/users-admin`,
 * contributed to the shell's `NAVBAR_END_SLOT`): the signed-in user's avatar +
 * dropdown with their name/email, a link to their own profile, and Logout.
 * Signed in as Ada (a member in the roster) so "My profile" lands on a real
 * detail page.
 */
test.describe('Account menu', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page, {
            id: 'u_ada',
            name: 'Ada Lovelace',
            email: 'ada@ortha.dev'
        });
        await mockMembers(page);
        await mockWorkspaces(page);
        await mockEmptyActivity(page);
        await mockUserSessions(page);
        await mockUserDetail(page);
    });

    test('shows the signed-in account in the toolbar dropdown [shell:I-13]', async ({
        membersPage
    }) => {
        await membersPage.goto();

        // Asserted on the closed trigger, which is where the address is
        // rendered — the open dropdown holds the two actions and nothing else.
        // It also has to be read *before* the click: the menu is modal, so
        // opening it `aria-hidden`s the page root and the trigger drops out of
        // the accessibility tree, taking every role-based locator with it.
        await expect(
            membersPage.accountMenuEmail('ada@ortha.dev')
        ).toBeVisible();

        await membersPage.openAccountMenu();

        await expect(membersPage.accountMenuItem('My profile')).toBeVisible();
        await expect(membersPage.accountMenuItem('Logout')).toBeVisible();
    });

    test('"My profile" opens the current user’s detail page', async ({
        membersPage,
        userDetailPage,
        page
    }) => {
        await membersPage.goto();
        await membersPage.openAccountMenu();
        await membersPage.accountMenuItem('My profile').click();

        await expect(page).toHaveURL(/\/users\/u_ada/);
        await expect(userDetailPage.heading('Ada Lovelace')).toBeVisible();
    });

    test('falls back to the email when the account has no name', async ({
        membersPage,
        page
    }) => {
        // `name` is nullable on `/auth/me` — the seeded root admin has none —
        // so every place that renders a display name needs a fallback rather
        // than an empty row or a literal "null" (EC-04 on ORT-57).
        await mockSignedIn(page, {
            id: 'u_ada',
            name: null,
            email: 'ada@ortha.dev'
        });
        await membersPage.goto();

        await expect(membersPage.accountMenuTrigger()).toBeVisible();
        await expect(
            membersPage.accountMenuTrigger().getByText('ada@ortha.dev')
        ).toHaveCount(2);
        await expect(page.getByText('null', { exact: true })).toHaveCount(0);
    });

    test('Logout calls the logout endpoint', async ({ membersPage, page }) => {
        const logout = await spyLogout(page);
        await membersPage.goto();
        await membersPage.openAccountMenu();
        await membersPage.accountMenuItem('Logout').click();

        await expect.poll(() => logout.count).toBe(1);
    });
});
