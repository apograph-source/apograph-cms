import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    DEFAULT_MEMBERS,
    manyMembers,
    mockMembers,
    spyRevokeInvite,
    type MemberSeed
} from '../support/api/members';

/**
 * The Members table's **resilience** surfaces — the states an admin reaches by
 * emptying the last page or by opening somebody else's link. Both are about the
 * page number, and they pull in opposite directions: a shrinking roster has to
 * drag `page` back, while a deep link has to be left exactly where it was
 * found. One clamp serves both, and the thing that keeps them apart is that it
 * waits for a real response first. The API is mocked at the network layer, so
 * no backend is needed.
 */
test.describe('Members resilience', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
    });

    /**
     * 21 members at the default 10 per page, so page 3 holds exactly one — and
     * that one is the pending invite, because Revoke is the only row action
     * that removes a row rather than flipping a pill.
     */
    function rosterWithLoneInviteOnPageThree(): MemberSeed[] {
        const pending = DEFAULT_MEMBERS.find(
            (member) => member.status === 'pending'
        )!;
        return [
            ...manyMembers(20),
            { ...pending, id: 'u_tail', email: 'tail@ortha.dev' }
        ];
    }

    test('revoking the last row on the last page pulls the pager back instead of stranding it', async ({
        page,
        membersPage
    }) => {
        const roster = rosterWithLoneInviteOnPageThree();
        await mockMembers(page, roster);
        // The same array, so the deletion sticks across the refetch that
        // follows — otherwise the row reappears and the page count never moves.
        await spyRevokeInvite(page, roster);
        await page.goto('/users?page=3');

        await expect(membersPage.pageReadout()).toHaveText('Page 3 of 3');
        await expect(membersPage.row('tail@ortha.dev')).toBeVisible();

        await membersPage.openActions('tail@ortha.dev');
        await membersPage.menuItem('Revoke invite').click();
        await membersPage.confirmAction('Delete invite').click();

        // The server does not clamp `page` past `pageCount` — it answers with
        // an empty `items` and the true `total` — so the clamp is the admin's
        // job. Without it the reader is left on a page that no longer exists,
        // with the pager hidden (one page's worth of results) and no way back.
        await expect(page).toHaveURL(/[?&]page=2\b/);
        await expect(membersPage.pageReadout()).toHaveText('Page 2 of 2');
        await expect(membersPage.paginationRange()).toHaveText(/^11.20 of 20$/);
    });

    test('a deep link to page 3 is not reset to page 1 before the first response lands', async ({
        page,
        membersPage
    }) => {
        const roster = rosterWithLoneInviteOnPageThree();
        // Held open so the assertions below land inside the window the bug
        // lived in: with no data yet `total` is 0 and `pageCount` is 1, so a
        // clamp that did not wait for a real response would decide page 3 was
        // past the end and rewrite the URL before anyone had answered.
        await mockMembers(page, roster, { delayMs: 2_000 });
        await page.goto('/users?page=3');

        await expect(membersPage.tableSkeleton()).toBeVisible();
        await expect(page).toHaveURL(/[?&]page=3\b/);

        // And once it lands, page 3 is what opens — a shared link survives.
        await expect(membersPage.pageReadout()).toHaveText('Page 3 of 3');
        await expect(membersPage.row('tail@ortha.dev')).toBeVisible();
        await expect(page).toHaveURL(/[?&]page=3\b/);
    });
});
