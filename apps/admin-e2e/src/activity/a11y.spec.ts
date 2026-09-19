import { type Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockPreferences } from '../support/api/preferences';
import {
    DEAD_LETTERS,
    mockActivity,
    mockDeadLetters
} from '../support/api/activity';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * Accessibility scans (axe, WCAG 2.1 A/AA + best-practice) of the Activity
 * page's dead-letter surface — the banner, and the dialog **open**, in both
 * themes.
 *
 * Open, because a closed dialog scans nothing: Radix renders no portal at all
 * until it is, so a scan of the page with the trigger sitting there says
 * precisely nothing about the table, the row buttons or the dialog's own name.
 *
 * Both themes, because the dark palette is a second, independently authored set
 * of colour tokens and a light scan is not a statement about it.
 *
 * A regression guard, not a conformance claim.
 */

/** Proof the dark palette is actually in force before a scan claims to cover it. */
async function expectDarkTheme(page: Page): Promise<void> {
    await expect
        .poll(async () =>
            ((await page.locator('html').getAttribute('class')) ?? '')
                .split(/\s+/)
                .includes('dark')
        )
        .toBe(true);
}

test.describe('Activity dead letters accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
        await mockDeadLetters(
            page,
            DEAD_LETTERS.map((row) => ({ ...row }))
        );
    });

    test('the page with the banner up', async ({
        activityLogPage,
        makeAxe
    }) => {
        await activityLogPage.goto();
        await expect(activityLogPage.deadLettersTrigger()).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });

    test('the dialog, open', async ({ activityLogPage, makeAxe }) => {
        await activityLogPage.goto();
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersTable()).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });

    test('the dialog, open, dark theme', async ({
        page,
        activityLogPage,
        makeAxe
    }) => {
        await mockPreferences(page, { theme: 'dark' });
        await activityLogPage.goto();
        await expectDarkTheme(page);
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersTable()).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });

    test('the banner in dark theme', async ({
        page,
        activityLogPage,
        makeAxe
    }) => {
        await mockPreferences(page, { theme: 'dark' });
        await activityLogPage.goto();
        await expectDarkTheme(page);
        await expect(activityLogPage.deadLettersTrigger()).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });

    test('the dialog’s error state, open', async ({
        page,
        activityLogPage,
        makeAxe
    }) => {
        await activityLogPage.goto();
        await expect(activityLogPage.deadLettersTrigger()).toBeVisible();
        await mockDeadLetters(page, [], { status: 500 });
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersError()).toBeVisible({
            timeout: 20_000
        });
        await expectNoA11yViolations(makeAxe());
    });

    test('each Retry button is named for its own row', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersTable()).toBeVisible();

        // axe cannot make this check: three buttons all named "Retry" pass
        // every naming rule it has and are still useless to anyone listening
        // rather than looking. Each name has to say *which* event.
        const names = await activityLogPage.deadLetterRetryLabels();
        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);
        expect(names.some((name) => name.includes('entry.published'))).toBe(
            true
        );
    });

    test('the table is named and its columns are real header cells', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.deadLettersTrigger().click();
        await expect(activityLogPage.deadLettersTable()).toBeVisible();

        // An `sr-only` <caption> says what the table lists; the header cells are
        // `<th scope="col">`, not styled `<td>`s.
        await expect(activityLogPage.deadLettersCaption()).toHaveText(
            'Events that could not be recorded'
        );
        const scopes = await activityLogPage.deadLettersHeaderScopes();
        expect(scopes).not.toHaveLength(0);
        expect(scopes.every((scope) => scope === 'col')).toBe(true);

        // Nothing here is sortable, so nothing claims to be (`aria-sort` on a
        // column with no sort control is a lie AT will repeat).
        await expect(activityLogPage.sortedCells()).toHaveCount(0);
    });
});
