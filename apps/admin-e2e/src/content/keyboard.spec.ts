import { type Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { I18N_WORKSPACE, mockI18n } from '../support/api/i18n';

/**
 * Keyboard operability for the entry editor's **locale menu** — what axe
 * cannot assert.
 *
 * The chip used to be a `Badge`, which is a `<div>`: giving Radix a non-button
 * trigger costs the menu its whole keyboard contract, and the failure is
 * invisible to a scanner because nothing about the markup is *wrong* — the
 * menu simply never opens. These cases pin the three halves of that contract:
 * the trigger activates on both Enter and Space, the rows are arrow-navigable,
 * and Escape closes the menu and puts focus back where it came from.
 */
test.describe('Entry editor keyboard operability', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    async function openEditor(page: Page) {
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
    }

    test('the locale chip opens on Enter', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditor(page);
        await contentLibraryPage.editorSave.waitFor();

        await contentLibraryPage.editorTitleChip.focus();
        await page.keyboard.press('Enter');

        await expect(contentLibraryPage.localeMenu).toBeVisible();
    });

    test('the locale chip opens on Space', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditor(page);
        await contentLibraryPage.editorSave.waitFor();

        await contentLibraryPage.editorTitleChip.focus();
        await page.keyboard.press('Space');

        await expect(contentLibraryPage.localeMenu).toBeVisible();
    });

    test('the menu is arrow-navigable', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditor(page);
        await contentLibraryPage.editorSave.waitFor();

        // Opened from the keyboard, Radix puts focus on the **first** row
        // (English, the current locale) — opening by pointer does not, so the
        // two are different states and this is the one being asserted.
        await contentLibraryPage.editorTitleChip.focus();
        await page.keyboard.press('Enter');
        await expect(contentLibraryPage.localeMenuItem('English')).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(contentLibraryPage.switchLocale('Deutsch')).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(
            contentLibraryPage.createTranslation('Français')
        ).toBeFocused();
    });

    test('Escape closes the menu and returns focus to the chip', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditor(page);
        await contentLibraryPage.editorSave.waitFor();
        await contentLibraryPage.openLocaleMenu();

        await page.keyboard.press('Escape');

        await expect(contentLibraryPage.localeMenu).toHaveCount(0);
        // Focus on `<body>` after closing an overlay is the stranding this
        // guards against — the reader would have to tab in from the top of the
        // page to get back to where they were.
        await expect(contentLibraryPage.editorTitleChip).toBeFocused();
    });

    test('a locale is chosen with the keyboard alone', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditor(page);
        await contentLibraryPage.editorSave.waitFor();

        await contentLibraryPage.editorTitleChip.focus();
        await page.keyboard.press('Enter');
        await contentLibraryPage.switchLocale('Deutsch').focus();
        await page.keyboard.press('Enter');

        await contentLibraryPage.localeSwitchSettled();
        await expect(page).toHaveURL(/\/localized_post\/lp-de-1$/);
    });
});
