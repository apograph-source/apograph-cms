import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    DEFAULT_MEMBERS,
    mockMembers,
    spySetMemberStatus
} from '../support/api/members';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    mockEmptyActivity,
    mockUserDetail,
    mockUserSessions
} from '../support/api/userDetail';
import { expectNoA11yViolations } from '../support/a11y';

/** Ada — the roster's sole admin, so the guardrail blocks suspending her. */
const ADA = DEFAULT_MEMBERS[0];
/** Grace — an ordinary active member: the only one Suspend applies to. */
const GRACE = DEFAULT_MEMBERS[1];
/** Alan — a pending invite, so there is no sign-in access to suspend yet. */
const ALAN = DEFAULT_MEMBERS[2];
/** Katherine — already suspended, so the card offers Reactivate. */
const KATHERINE = DEFAULT_MEMBERS[3];

/**
 * The Access tab's **sign-in access** card (`/users/:id/access`,
 * `@orthacms/users-admin`) — the suspend/reactivate half. Its password half is
 * `password-reset.spec.ts`.
 *
 * The same *operation* is driven from the members list in
 * `destructive-actions.spec.ts`, which is what made this look covered: they are
 * different components, and only the list one was tested. This page is where
 * the three account states are actually explained — and where the two
 * guardrails (the last admin, your own account) are rendered as a reason rather
 * than discovered on submit.
 */
test.describe('Sign-in access', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await mockWorkspaces(page);
        await mockEmptyActivity(page);
        await mockUserSessions(page);
        await mockUserDetail(page);
    });

    test('offers Suspend for an active member, and says what it costs', async ({
        userDetailPage
    }) => {
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            userDetailPage.accessStatus('This member can sign in')
        ).toBeVisible();
        // The consequence is the load-bearing part: an admin has to know that
        // memberships and content survive, or they reach for Revoke instead.
        await expect(
            userDetailPage.accessStatus(/revokes active sessions/)
        ).toBeVisible();
        await expect(
            userDetailPage.accessAction('Suspend member')
        ).toBeEnabled();
    });

    test('offers Reactivate for a suspended member', async ({
        userDetailPage
    }) => {
        await userDetailPage.goto(KATHERINE.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            userDetailPage.accessStatus('This member is suspended', {
                exact: true
            })
        ).toBeVisible();
        await expect(
            userDetailPage.accessAction('Reactivate member')
        ).toBeEnabled();
        await expect(userDetailPage.accessAction('Suspend member')).toHaveCount(
            0
        );
    });

    test('offers nothing for an invite that was never accepted', async ({
        userDetailPage
    }) => {
        // `pending` is read-only on the server too — there is no sign-in to
        // take away yet — so the card explains rather than offering a button
        // that would fail.
        await userDetailPage.goto(ALAN.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            userDetailPage.accessStatus('Invite not accepted yet')
        ).toBeVisible();
        await expect(userDetailPage.accessAction('Suspend member')).toHaveCount(
            0
        );
        await expect(
            userDetailPage.accessAction('Reactivate member')
        ).toHaveCount(0);
    });

    test('confirms before suspending, naming the member', async ({
        page,
        userDetailPage
    }) => {
        const status = await spySetMemberStatus(page, GRACE);
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');

        await userDetailPage.accessAction('Suspend member').click();

        await expect(
            page.getByRole('dialog').getByText(`Suspend ${GRACE.name}?`)
        ).toBeVisible();
        // Nothing has been sent yet — the dialog is the decision point, not a
        // receipt for one already taken.
        expect(status.disabled).toBe(0);

        await userDetailPage.confirmButton('Suspend member').click();
        await expect.poll(() => status.disabled).toBe(1);
    });

    test('sends the enable direction when reactivating', async ({
        page,
        userDetailPage
    }) => {
        // One hook serves both directions, so the direction is worth pinning:
        // the wrong one here suspends the member an admin was rescuing.
        const status = await spySetMemberStatus(page, KATHERINE);
        await userDetailPage.goto(KATHERINE.id);
        await userDetailPage.openTab('Sign-in access');

        await userDetailPage.accessAction('Reactivate member').click();
        await userDetailPage.confirmButton('Reactivate member').click();

        await expect.poll(() => status.enabled).toBe(1);
        expect(status.disabled).toBe(0);
    });

    test('abandoning the dialog changes nothing', async ({
        page,
        userDetailPage
    }) => {
        const status = await spySetMemberStatus(page, GRACE);
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');

        await userDetailPage.accessAction('Suspend member').click();
        await page.keyboard.press('Escape');

        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(status.disabled).toBe(0);
        await expect(
            userDetailPage.accessAction('Suspend member')
        ).toBeEnabled();
    });

    test('blocks suspending the last admin, and says why', async ({
        page,
        userDetailPage
    }) => {
        // The server refuses this too. Rendering the reason up front is the
        // difference between "here is what to do instead" and a failed submit
        // that reads as a bug.
        const status = await spySetMemberStatus(page, ADA);
        await userDetailPage.goto(ADA.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            userDetailPage.accessStatus(/last remaining admin/)
        ).toBeVisible();
        await expect(
            userDetailPage.accessAction('Suspend member')
        ).toBeDisabled();
        expect(status.disabled).toBe(0);
    });

    test('blocks suspending your own account, and says why', async ({
        page,
        userDetailPage
    }) => {
        // Signed in *as* Grace, looking at Grace: a different guardrail from
        // the last-admin one, and the one an admin is most likely to hit by
        // accident.
        await mockSignedIn(page, { id: GRACE.id, email: GRACE.email });
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            userDetailPage.accessStatus(/can’t suspend your own account/)
        ).toBeVisible();
        await expect(
            userDetailPage.accessAction('Suspend member')
        ).toBeDisabled();
    });

    test('accessibility — the tab has no axe violations', async ({
        userDetailPage,
        makeAxe
    }) => {
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');
        await userDetailPage.accessAction('Suspend member').waitFor();

        await expectNoA11yViolations(makeAxe());
    });

    test('accessibility — the suspend confirm has no axe violations', async ({
        page,
        userDetailPage,
        makeAxe
    }) => {
        // The destructive confirm had no scan anywhere in the suite.
        await spySetMemberStatus(page, GRACE);
        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');
        await userDetailPage.accessAction('Suspend member').click();
        await page.getByRole('dialog').waitFor();

        await expectNoA11yViolations(makeAxe());
    });
});
