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
 * These two pin what happens to the editor's **own** input afterwards, and they
 * are halves of one contract: a tab move keeps the draft, **and** it does not
 * prompt about it. Both are about the same click, which is why they live
 * together.
 *
 * The editor's tabs are route segments (`/new/relations`), so moving between
 * them is a navigation — but it is a navigation **within one draft**, not to
 * another record. That distinction is the whole contract here:
 *
 *   - The draft survives it. It did not always: `onTabChange` navigates with
 *     `state: location.state`, the history API structured-clones that state, and
 *     the prefill came back equal but differently *identified* — enough to
 *     re-key the memo behind `useEntryForm`'s `initialValues` and re-seed the
 *     form over whatever had been typed. The translation draft is the one create
 *     path carrying state, which is why it alone lost its title and slug while a
 *     plain create kept them. Fixed by snapshotting the prefill once per create
 *     session (`useCreatePrefill`).
 *   - Nothing asks the author to confirm it. The unsaved-changes guard is for
 *     leaving a record for a *different* one — which is what a locale switch
 *     does, and it is guarded there (`i18n.spec.ts`, "picking a locale with
 *     unsaved edits asks first, then completes"). A tab move leaves nothing, so
 *     a prompt would be a nag rather than a safeguard.
 *
 * Found driving the live stack for `ORT-227`.
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

        // The draft is still unsaved and the author never left it, so the title
        // is still theirs. The prefill seeded this form once, on arrival; it is
        // not live input to be re-applied on every navigation the editor takes.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Bottes d’hiver'
        );
    });

    test('moves between tabs on a dirty translation draft without prompting [ORT-227]', async ({
        page,
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(I18N_WORKSPACE.id);
        await contentLibraryPage.typeLink('Localized posts').click();
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.startTranslation('Français');
        await contentLibraryPage.localeSwitchSettled();
        await contentLibraryPage.fieldTextbox('Title').fill('Bottes d’hiver');

        await contentLibraryPage.openEditorTab('Relations');

        // The guard is for leaving this record for another — picking a locale
        // raises it (AC-9), and `i18n.spec.ts` pins both answers to it. A tab
        // move goes nowhere: same draft, same unsaved values, one route segment
        // deeper. Prompting here would ask the author to confirm abandoning
        // work they are not abandoning, so nothing may raise it.
        //
        // Checked before the URL so that a guard added on this path is named as
        // a guard. It would also block the navigation, which the URL below
        // catches — but "expected /new/relations" is a poor way to report that
        // someone introduced a confirmation.
        await expect(contentLibraryPage.unsavedChangesDialog).toHaveCount(0);

        // And the move really happened, so the assertion above was made about a
        // completed tab change rather than a click that went nowhere.
        await expect(page).toHaveURL(/\/new\/relations/);
    });
});
