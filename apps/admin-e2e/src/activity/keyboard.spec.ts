import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    DEAD_LETTERS,
    mockActivity,
    mockDeadLetters,
    spyRetryDeadLetter,
    type DeadLetterSeed
} from '../support/api/activity';

/**
 * Keyboard operability of the dead-letter dialog — the part axe cannot check.
 *
 * The retry surface is the one thing on this page that *does* something, so the
 * three properties that matter are the three a scanner is blind to: that the
 * dialog traps focus while it is open, that it gives focus back on Escape, and
 * that a row that goes busy does not fall out of the tab order underneath the
 * finger that pressed it.
 */

/** A fresh, independent copy of the parked-event seed. */
function parkedEvents(): DeadLetterSeed[] {
    return DEAD_LETTERS.map((row) => ({ ...row }));
}

test.describe('Activity dead letters keyboard', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
    });

    test('the dialog takes focus, keeps it, and gives it back on Escape', async ({
        page,
        activityLogPage
    }) => {
        await mockDeadLetters(page, parkedEvents());
        await activityLogPage.goto();

        const trigger = activityLogPage.deadLettersTrigger();
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(activityLogPage.deadLettersTable()).toBeVisible();

        // Focus moved into the dialog rather than being left behind it — a
        // keyboard user who opens an overlay and stays outside it is stranded.
        await expect
            .poll(() => activityLogPage.focusIsInsideDialog())
            .toBe(true);

        // Ten tabs cannot escape the trap; the whole dialog is fewer stops than
        // that, so this wraps several times and must land inside every time.
        for (let index = 0; index < 10; index += 1) {
            await page.keyboard.press('Tab');
            const inside = await activityLogPage.focusIsInsideDialog();
            expect(inside, `Tab ${index + 1} left the dialog`).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(activityLogPage.deadLettersDialog()).toBeHidden();
        // Back to the trigger, not to `<body>`.
        await expect(trigger).toBeFocused();
    });

    test('every row can be reached and retried without a mouse', async ({
        page,
        activityLogPage
    }) => {
        const parked = parkedEvents();
        await mockDeadLetters(page, parked);
        const retry = await spyRetryDeadLetter(page, parked);

        await activityLogPage.goto();
        await activityLogPage.deadLettersTrigger().focus();
        await page.keyboard.press('Enter');
        await expect(activityLogPage.deadLettersTable()).toBeVisible();

        const target = activityLogPage.deadLetterRetry('media.asset.uploaded');
        await target.focus();
        await expect(target).toBeFocused();
        await page.keyboard.press('Enter');

        await expect.poll(() => retry.ids).toEqual([DEAD_LETTERS[2].id]);
    });

    test('a busy row keeps its tab stop', async ({ page, activityLogPage }) => {
        const parked = parkedEvents();
        await mockDeadLetters(page, parked);
        // Hold the POST open so the busy state can be observed at all.
        await page.route(
            '**/api/activity/dead-letters/*/retry',
            async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1_500));
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        ...DEAD_LETTERS[0],
                        attempts: 0,
                        nextAttemptAt: null
                    })
                });
            }
        );

        await activityLogPage.goto();
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersTable()).toBeVisible();

        const target = activityLogPage.deadLetterRetry('entry.published');
        await target.click();

        // `aria-disabled`, not `disabled`: a disabled button leaves the tab
        // order, so the keyboard user who just pressed Retry would lose their
        // place at the exact moment the app went busy.
        await expect(target).toHaveAttribute('aria-disabled', 'true');
        await expect(target).not.toHaveAttribute('disabled', '');
        await target.focus();
        await expect(target).toBeFocused();

        // The other rows are untouched — the pending state is scoped to the row
        // that was pressed, not to the panel.
        const other = activityLogPage.deadLetterRetry('user.invited');
        await expect(other).not.toHaveAttribute('aria-disabled', 'true');
    });
});
