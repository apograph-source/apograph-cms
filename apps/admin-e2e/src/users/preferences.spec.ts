import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockMembers } from '../support/api/members';
import {
    mockWorkspaceSettingsApi,
    mockWorkspaces
} from '../support/api/workspaces';
import { mockPreferences } from '../support/api/preferences';
import {
    mockEmptyActivity,
    mockUserDetail,
    mockUserSessions
} from '../support/api/userDetail';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * The self-only **Preferences** tab on the user detail page
 * (`/users/:id/preferences`, `@orthacms/users-admin`): the colour-theme picker
 * (Light / Dark / System). Signed in as Ada (a member in the roster) so viewing
 * her own detail page is "self"; viewing another member is not. Theme reads/
 * writes go through the `mockPreferences` stub. `mockSignedIn` satisfies the
 * shell's auth probe (and, since it matches the viewed id, unlocks the tab).
 */
test.describe('User preferences (theme)', () => {
    const SELF = {
        id: 'u_ada',
        name: 'Ada Lovelace',
        email: 'ada@ortha.dev'
    };

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page, SELF);
        await mockMembers(page);
        await mockWorkspaces(page);
        await mockEmptyActivity(page);
        await mockUserSessions(page);
        await mockUserDetail(page);
    });

    test('shows the Preferences tab only on your own profile', async ({
        page,
        userDetailPage
    }) => {
        await mockPreferences(page);

        // Your own profile — the tab is present.
        await userDetailPage.goto('u_ada');
        await expect(userDetailPage.tab('Preferences')).toBeVisible();

        // Another member's profile — no Preferences tab.
        await userDetailPage.goto('u_grace');
        await expect(userDetailPage.heading('Grace Hopper')).toBeVisible();
        await expect(userDetailPage.tab('Preferences')).toHaveCount(0);
    });

    test('redirects a deep link to someone else’s preferences', async ({
        page,
        userDetailPage
    }) => {
        await mockPreferences(page);
        await page.goto('/users/u_grace/preferences');

        // Self-only route → falls back to that member's General tab.
        await expect(page).toHaveURL(/\/users\/u_grace\/general/);
        await expect(userDetailPage.nameInput()).toHaveValue('Grace Hopper');
    });

    test('selecting a theme applies it and saves it (PUT /api/preferences)', async ({
        page,
        userDetailPage
    }) => {
        const prefs = await mockPreferences(page, { theme: 'system' });
        await page.goto('/users/u_ada/preferences');
        await expect(userDetailPage.themeOption('Dark')).toBeVisible();

        await userDetailPage.selectTheme('Dark');

        // Applied app-wide (the `.dark` class) and persisted (one PUT), with a
        // confirmation toast.
        await expect.poll(() => userDetailPage.isDark()).toBe(true);
        await expect.poll(() => prefs.puts).toEqual(['dark']);
        await expect(userDetailPage.savedToast()).toBeVisible();
    });

    test('does not re-save the theme already in effect', async ({
        page,
        userDetailPage
    }) => {
        const prefs = await mockPreferences(page, { theme: 'dark' });
        await page.goto('/users/u_ada/preferences');
        await expect(userDetailPage.themeOption('Dark')).toBeVisible();

        // Dark is already the stored/active theme — re-selecting it is a no-op.
        await userDetailPage.selectTheme('Dark');
        await expect(userDetailPage.themeOption('Light')).toBeVisible();
        expect(prefs.puts).toEqual([]);
    });

    test('hydrates the saved theme app-wide on load', async ({
        page,
        userDetailPage
    }) => {
        // A returning dark-theme user: the invisible ThemeSync pulls it from the
        // server and applies it on any authenticated route, before they ever
        // open the Preferences tab.
        await mockPreferences(page, { theme: 'dark' });
        await page.goto('/users');

        await expect.poll(() => userDetailPage.isDark()).toBe(true);
    });

    test('the theme picker has no accessibility violations', async ({
        page,
        userDetailPage,
        makeAxe
    }) => {
        await mockPreferences(page);
        await page.goto('/users/u_ada/preferences');
        await expect(userDetailPage.themeOption('System')).toBeVisible();

        await expectNoA11yViolations(makeAxe());
    });

    test('the dark theme has no accessibility violations', async ({
        page,
        userDetailPage,
        makeAxe
    }) => {
        // The dark palette is a second, independently authored set of colour
        // tokens — nothing about the light scan covers it. Without this, a
        // `*-foreground` that fails contrast on its dark surface ships green.
        // Seeded as the *stored* theme so ThemeSync applies it app-wide, then
        // scanned on a page dense with semantic surfaces (badges, buttons,
        // status pills) rather than the picker alone.
        await mockPreferences(page, { theme: 'dark' });
        await page.goto('/users/u_ada/general');
        await expect.poll(() => userDetailPage.isDark()).toBe(true);
        // `.dark` only means ThemeSync's own request came back — it says
        // nothing about the member's. Those are two independent reads, and the
        // preferences one usually wins, so without this the scan can land on
        // the loading skeleton: no `<h1>`, none of the semantic surfaces this
        // test exists to check, and a `page-has-heading-one` violation whenever
        // the member read is slow enough.
        await expect(userDetailPage.heading('Ada Lovelace')).toBeVisible();

        await expectNoA11yViolations(makeAxe());
    });

    test('applies the saved theme on a route that overrides the sidebar', async ({
        page,
        userDetailPage,
        workspaceSettingsPage
    }) => {
        // ThemeSync rides the sidebar FOOTER, not the section slot: the
        // workspace shell replaces the sidebar's *global* region wholesale via
        // `useSidebarContent`, so a hydrator mounted there would never run for
        // someone who deep-links straight into a workspace. This deep-links into
        // the shell — the one place the override is live — rather than the
        // /workspaces list, which still renders the global sidebar.
        await mockWorkspaceSettingsApi(page, [
            {
                id: 'ws_theme',
                name: 'Marketing site',
                slug: 'marketing-site',
                description: 'Landing pages and the blog.',
                color: 'violet',
                status: 'active',
                members: [{ ...SELF }],
                content: []
            }
        ]);
        await mockPreferences(page, { theme: 'dark' });

        await workspaceSettingsPage.goto('ws_theme');

        await expect.poll(() => userDetailPage.isDark()).toBe(true);
    });
});
