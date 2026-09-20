import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { DEFAULT_MEMBERS, mockMembers } from '../support/api/members';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    mockEmptyActivity,
    mockUserDetail,
    mockUserSessions
} from '../support/api/userDetail';
import {
    RESET_TOKEN,
    spyIssuePasswordReset
} from '../support/api/passwordReset';

const GRACE = DEFAULT_MEMBERS[1];
const ALAN = DEFAULT_MEMBERS[2];
const KATHERINE = DEFAULT_MEMBERS[3];

/**
 * The Access tab's password card (`/users/:id/access`,
 * `@orthacms/users-admin`): an admin generates a single-use reset link for a
 * member and hands it over, because nothing emails one yet.
 *
 * The behaviour that matters is what happens around the secret. Generating
 * rotates the token server-side, so whatever link was outstanding is already
 * dead by the time the dialog opens — which makes "the admin actually captured
 * this one" part of the operation rather than a nicety.
 */
test.describe('generate a password reset link', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await mockWorkspaces(page);
        await mockEmptyActivity(page);
        await mockUserSessions(page);
        await mockUserDetail(page);
    });

    test('reveals the link once, for the right member', async ({
        page,
        userDetailPage
    }) => {
        const spy = await spyIssuePasswordReset(page, { member: GRACE });

        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');
        await userDetailPage.generateResetLink().click();

        expect(spy.count).toBe(1);
        await expect(userDetailPage.resetLinkDialog()).toBeVisible();
        await expect(userDetailPage.resetLinkField(GRACE.email)).toHaveValue(
            new RegExp(`/identity/reset-password\\?token=${RESET_TOKEN}$`)
        );
    });

    test('guards the first dismissal until the link has been copied', async ({
        page,
        userDetailPage
    }) => {
        await spyIssuePasswordReset(page, { member: GRACE });

        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');
        await userDetailPage.generateResetLink().click();
        await expect(userDetailPage.resetLinkDialog()).toBeVisible();

        // Closing without copying loses the only copy that exists — and the
        // server refuses another for a minute, so the mistake isn't even
        // immediately fixable.
        await userDetailPage.resetLinkDone().click();
        await expect(userDetailPage.resetLinkDialog()).toBeVisible();
        await expect(
            page.getByText(/haven’t copied the link yet/)
        ).toBeVisible();
    });

    test('offers no reset for a member who has not accepted their invite', async ({
        page,
        userDetailPage
    }) => {
        const spy = await spyIssuePasswordReset(page, { member: ALAN });

        await userDetailPage.goto(ALAN.id);
        await userDetailPage.openTab('Sign-in access');

        // A pending member has no password to reset — the card says so and
        // locks the button rather than letting the server 409 the click.
        await expect(page.getByText(/no password to reset/)).toBeVisible();
        await expect(userDetailPage.generateResetLink()).toBeDisabled();
        expect(spy.count).toBe(0);
    });

    test('offers no reset for a suspended member', async ({
        page,
        userDetailPage
    }) => {
        await spyIssuePasswordReset(page, { member: KATHERINE });

        await userDetailPage.goto(KATHERINE.id);
        await userDetailPage.openTab('Sign-in access');

        await expect(
            page.getByText(/suspended and can’t sign in/)
        ).toBeVisible();
        await expect(userDetailPage.generateResetLink()).toBeDisabled();
    });

    test('says how long to wait when a link was just generated', async ({
        page,
        userDetailPage
    }) => {
        await spyIssuePasswordReset(page, {
            member: GRACE,
            status: 409,
            code: 'PASSWORD_RESET_RECENTLY_SENT',
            retryAfterSeconds: 42
        });

        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Sign-in access');
        await userDetailPage.generateResetLink().click();

        // The conflict is actionable and the body says how — "something went
        // wrong" would leave the admin retrying into the same refusal.
        await expect(page.getByText(/Wait 42 seconds/)).toBeVisible();
        await expect(userDetailPage.resetLinkDialog()).toBeHidden();
    });
});
