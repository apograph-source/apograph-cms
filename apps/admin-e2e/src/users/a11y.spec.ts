import { test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockMembers, DEFAULT_MEMBERS } from '../support/api/members';
import { mockWorkspaces } from '../support/api/workspaces';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * Accessibility scans (axe, WCAG 2.1 A/AA) of the Members page and its dynamic
 * states — the table, the invite wizard's steps, the row menu, and the
 * no-access state. A regression guard, not a conformance claim.
 */
test.describe('Members accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockMembers(page);
    });

    test('table — initial', async ({ membersPage, makeAxe }) => {
        await membersPage.goto();
        await membersPage.heading.waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('table — loading skeleton', async ({ membersPage, page, makeAxe }) => {
        // Hold the list response open so the table skeleton stays on screen
        // (the header + toolbar are already live) while axe scans it.
        await mockMembers(page, DEFAULT_MEMBERS, { delayMs: 30_000 });
        await membersPage.goto();
        await membersPage.tableSkeleton().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('invite wizard — details step', async ({ membersPage, makeAxe }) => {
        await membersPage.goto();
        await membersPage.inviteButton.click();
        await membersPage.inviteHeading().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('invite wizard — workspaces step', async ({
        membersPage,
        page,
        makeAxe
    }) => {
        await mockWorkspaces(page);
        await membersPage.goto();
        await membersPage.inviteButton.click();
        await membersPage.inviteEmail().fill('new@ortha.dev');
        await membersPage.continueToRole().click();
        await membersPage.continueToWorkspaces().click();
        await membersPage.inviteWorkspace('Marketing site').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('row menu — open', async ({ membersPage, makeAxe }) => {
        await membersPage.goto();
        await membersPage.openActions('Grace Hopper');
        await membersPage.menuItem('General').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('empty state — no matches', async ({ membersPage, makeAxe }) => {
        await membersPage.goto();
        await membersPage.search.fill('nobody-xyz');
        await membersPage.emptyText('No members match').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('no-access state', async ({ membersPage, makeAxe, page }) => {
        await mockSignedIn(page, { permissions: [] });
        await membersPage.goto();
        await membersPage.noAccessText().waitFor();
        await expectNoA11yViolations(makeAxe());
    });
});
