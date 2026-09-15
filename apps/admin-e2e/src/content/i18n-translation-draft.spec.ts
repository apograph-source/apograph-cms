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
 * **Both tests must prove the draft is dirty before they lean on it.** A fill
 * issued while the locale-switch cover is still up is dropped on the floor —
 * the cover marks the app root `inert`, so input never reaches the control and
 * nothing raises an error (see `ContentLibraryPage.localeSwitchSettled`). A test
 * that skips the read-back is then asserting about a *clean* form: the title
 * would have been empty all along, no guard could have fired, and the second
 * test below would pass without touching the behaviour it names.
 *
 * Found driving the live stack for `ORT-227`; the regression they pin is
 * `ORT-228`.
 */
test.describe('Content i18n — the translation draft', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    test('keeps what was typed when the editor moves between tabs [ORT-227][ORT-228]', async ({
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
        // The fill landed — see the header note. Without this the assertion at
        // the end could be comparing an empty field against an empty field.
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

    test('moves between tabs on a dirty translation draft without prompting [ORT-227][ORT-228]', async ({
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

        // **The precondition, asserted rather than assumed.** Everything below
        // is about what a dirty draft does *not* do, and "no prompt appeared" is
        // equally true of a form with nothing in it. If this fill were silently
        // dropped (see the header note) the rest of this test would still pass
        // and would mean nothing at all.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Bottes d’hiver'
        );

        await contentLibraryPage.openEditorTab('Relations');

        // The guard is for leaving this record for another — picking a locale
        // raises it (AC-9), and `i18n.spec.ts` pins both answers to it. A tab
        // move goes nowhere: same draft, same unsaved values, one route segment
        // deeper. Prompting here would ask the author to confirm abandoning
        // work they are not abandoning, so nothing may raise it.
        //
        // **Order matters.** `toHaveCount(0)` is satisfied by the first poll, so
        // on its own it would race a prompt that mounts a tick later. These two
        // positive waits give it something to be true *after*: the route landed,
        // and the editor re-rendered around the new tab. Read a failure by which
        // of the three fires —
        //
        //   - the URL or `aria-selected`  → a prompt that **blocks** navigation
        //     was added; the tab move never completed.
        //   - the count below             → a prompt that **doesn't** block was
        //     added; the move landed and something appeared over it anyway.
        await expect(page).toHaveURL(/\/new\/relations/);
        await expect(contentLibraryPage.editorTab('Relations')).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await expect(contentLibraryPage.unsavedChangesDialog).toHaveCount(0);
    });
});
