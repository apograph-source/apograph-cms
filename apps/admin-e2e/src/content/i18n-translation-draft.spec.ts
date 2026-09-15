import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { I18N_WORKSPACE, mockI18n } from '../support/api/i18n';

/**
 * The **translation draft** the locale menu opens (`ORT-227` AC-7): picking a
 * locale that has no sibling navigates to `…/new?locale=<slug>&localeGroupId=…`
 * carrying the source record's shared values in `location.state`, so the new
 * row starts from what the group already agrees on.
 *
 * These cover what happens to the editor's **own** input afterwards. The
 * editor's tabs are route segments (`/new/media`), so moving between them is a
 * navigation, and the create form is re-seeded on the way back. On a plain
 * create (`/new`, no `location.state`) that re-seed is a no-op and the typed
 * values survive; on a translation draft the carried state is re-applied and
 * overwrites them.
 *
 * Found driving the live stack for `ORT-227`, reproduced here.
 */
test.describe('Content i18n — the translation draft', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    test('keeps what was typed when the editor moves between tabs [ORT-227]', async ({
        page,
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(I18N_WORKSPACE.id);
        await contentLibraryPage.typeLink('Localized posts').click();
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // AC-7: a locale with no sibling opens a create form scoped to that
        // locale and translation group.
        await contentLibraryPage.startTranslation('Français');
        await expect(page).toHaveURL(/\/localized_post\/new\?/);
        await expect(page).toHaveURL(/locale=fr/);
        await contentLibraryPage.localeSwitchSettled();

        await contentLibraryPage.fieldTextbox('Title').fill('Bottes d’hiver');
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Bottes d’hiver'
        );

        // A tab is a route segment, so this is a navigation away and back —
        // exactly what an author does to attach a relation before saving.
        await contentLibraryPage.openEditorTab('Relations');
        await expect(page).toHaveURL(/\/new\/relations/);
        await contentLibraryPage.openEditorTab('General');

        // The draft is still unsaved, so the title has to still be there. It is
        // not: the create form is re-seeded from the `location.state` the menu
        // navigated with, and the re-seed wins over the author's own input.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Bottes d’hiver'
        );
    });

    test('a tab move on a dirty translation draft is guarded or lossless [ORT-227]', async ({
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(I18N_WORKSPACE.id);
        await contentLibraryPage.typeLink('Localized posts').click();
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.startTranslation('Français');
        await contentLibraryPage.localeSwitchSettled();
        await contentLibraryPage.fieldTextbox('Title').fill('Bottes d’hiver');

        // Picking a locale while dirty raises the app-wide guard (AC-9). Moving
        // tabs discards strictly more — the values are gone rather than
        // re-fetched — and raises nothing at all, so the author is never told.
        await contentLibraryPage.openEditorTab('Relations');
        await expect(contentLibraryPage.unsavedChangesDialog).toBeVisible();
    });
});
