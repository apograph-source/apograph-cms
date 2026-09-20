import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockActivity } from '../support/api/activity';

/**
 * The Home dashboard (`/`, from `@orthacms/shell-admin`). The greeting is the
 * shell's; the stat tiles + Workspaces panel are contributed by
 * `workspaces-admin` and the Recent activity panel by `activity-admin`, both via
 * the `HOME_SECTION_SLOT`. Data is real: workspaces from `GET /api/workspaces`,
 * events from `GET /api/activity` (stubbed here).
 */
test.describe('Home dashboard', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page, {
            name: 'Amara Okafor',
            email: 'amara@ortha.dev'
        });
        await mockWorkspaces(page);
        await mockActivity(page);
    });

    test('shows the greeting, stat tiles, and both panels', async ({
        homePage
    }) => {
        await homePage.goto();

        await expect(homePage.heading).toContainText('Amara Okafor');
        await expect(homePage.statTile('Active workspaces')).toBeVisible();
        await expect(homePage.statTile('Members')).toBeVisible();
        await expect(homePage.statTile('Content types')).toBeVisible();
        await expect(homePage.workspacesPanel).toBeVisible();
        await expect(homePage.activityPanel).toBeVisible();
    });

    test('the panels link through to their full pages', async ({
        homePage,
        page
    }) => {
        await homePage.goto();

        // Two "View all" links — one per panel (Workspaces, Recent activity).
        await expect(page.getByRole('link', { name: 'View all' })).toHaveCount(
            2
        );
    });
});
