import { type Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    I18N_WORKSPACE,
    mockI18n,
    spyEntryWrites,
    type EntryWrite
} from '../support/api/i18n';
import { type ContentLibraryPage } from '../support/pages/ContentLibraryPage';

/**
 * Content localization in the admin (`@apograph/i18n-admin`), driving the
 * Content Library's extension slots against a mocked API: the records-toolbar
 * locale switcher (and its `?locale=` round-trip), the Locales table column,
 * and the entry editor's title-row locale chip and the menu it opens (open a
 * sibling, create a translation).
 */
test.describe('Content i18n', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    async function openCollection(contentLibraryPage: ContentLibraryPage) {
        await contentLibraryPage.goto(I18N_WORKSPACE.id);
        await contentLibraryPage.typeLink('Localized posts').click();
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toBeVisible();
    }

    test('shows the locale switcher on a localized collection', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        // Defaults to the default locale (English).
        await expect(contentLibraryPage.localeSwitcher).toHaveText(
            /Locale: English|English/
        );
    });

    test('switching locale updates the URL and re-scopes the table', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);

        // Default (en) list shows the English rows, not the German sibling.
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toContainText('Winter boots');
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).not.toContainText('Winterstiefel');

        await contentLibraryPage.selectLocale(/Deutsch/);

        // The URL carries the active locale, and the table now shows the de row.
        await expect(page).toHaveURL(/locale=de/);
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toContainText('Winterstiefel');
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).not.toContainText('Winter boots');
    });

    test('opening a row and going back keeps the active locale', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.selectLocale(/Deutsch/);
        await expect(page).toHaveURL(/locale=de/);
        await contentLibraryPage.localeSwitchSettled();

        // The row's editor link carries the locale the table was showing…
        await contentLibraryPage.recordLink('Winterstiefel').click();
        await expect(page).toHaveURL(/\/localized_post\/[^/?]+\?.*locale=de/);

        // …so "Back to records" returns to that same list, not the default one.
        await contentLibraryPage.editorBackLink.click();
        await expect(page).toHaveURL(/\/localized_post\?.*locale=de/);
        await expect(contentLibraryPage.localeSwitcher).toHaveText(/Deutsch/);
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toContainText('Winterstiefel');
    });

    test('switching locale keeps the tab the user was working in', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // Working in Relations, switch to the German sibling…
        await contentLibraryPage.openEditorTab('Relations');
        await expect(page).toHaveURL(/\/relations$/);
        await contentLibraryPage.switchToLocale('Deutsch');

        // …the editor re-targets the sibling **on the same tab**, instead of
        // dumping the user back on General mid-task.
        await expect(page).toHaveURL(/\/localized_post\/[^/?]+\/relations$/);
        await expect(contentLibraryPage.editorTab('Relations')).toHaveAttribute(
            'aria-selected',
            'true'
        );
    });

    test('the default locale keeps a clean URL through the editor [i18n:I-06]', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);

        // The server scopes to the default locale when `?locale=` is absent, so
        // the default must not start spelling itself out in the URL.
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(page).toHaveURL(/\/localized_post\/[^/?]+$/);
        await contentLibraryPage.editorBackLink.click();
        await expect(page).toHaveURL(/\/localized_post$/);
    });

    test('the localized-field mark explains itself on hover and on focus', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // It was a bare span with a native `title` — invisible to keyboard and
        // touch users. Now a real focusable trigger with a tooltip.
        const mark = contentLibraryPage.localizedMark.first();
        await mark.hover();
        await expect(contentLibraryPage.tooltip).toHaveText(
            /can differ per locale/
        );

        await mark.blur();
        await mark.focus();
        await expect(contentLibraryPage.tooltip).toHaveText(
            /can differ per locale/
        );
    });

    test('splits the form into translated and shared field groups', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // Editing a shared field changes it for *every* locale, so the two sets
        // are labelled runs rather than interleaved.
        await expect(
            contentLibraryPage.fieldGroupHeading('Translated fields')
        ).toBeVisible();
        await expect(
            contentLibraryPage.fieldGroupHeading('Shared fields')
        ).toBeVisible();
    });

    test('marks how a relation carries across the record’s other locales', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await contentLibraryPage.openEditorTab('Relations');

        // `related` points at localized_post itself, so it is **mirrored**: the
        // mark is what explains both halves — why the picker hides other
        // locales' rows, and that picking one here links its translation
        // everywhere else. Neither is inferable from the card.
        const mark = contentLibraryPage
            .relationSyncMark('Follows translations')
            .first();
        await expect(mark).toBeVisible();
        await mark.hover();
        await expect(contentLibraryPage.tooltip).toHaveText(
            /every other locale links that record’s own translation/
        );
    });

    test('switching locale plays a brief "Switching…" overlay', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.selectLocale(/Deutsch/);
        // The transition flourish names the target locale.
        await expect(contentLibraryPage.localeSwitchOverlay).toHaveText(
            /Switching to Deutsch/
        );
    });

    test('the Locales column shows per-group locale badges', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);

        // The Locales column is off by default — enable it via the column picker.
        await contentLibraryPage.columnsButton.click();
        await contentLibraryPage.columnOption('Locales').click();
        await contentLibraryPage.columnsButton.click(); // close the popover

        // Group G1's row (Winter boots) has en + de badges linking to each
        // locale's editor; group G2's row (Rain jacket) has only an en badge.
        const g1Row = contentLibraryPage
            .recordRows('Localized posts')
            .filter({ hasText: 'Winter boots' });
        await expect(
            g1Row.getByRole('link', { name: /Open the en version/ })
        ).toBeVisible();
        await expect(
            g1Row.getByRole('link', { name: /Open the de version/ })
        ).toBeVisible();

        const g2Row = contentLibraryPage
            .recordRows('Localized posts')
            .filter({ hasText: 'Rain jacket' });
        await expect(
            g2Row.getByRole('link', { name: /Open the de version/ })
        ).toHaveCount(0);
    });

    test('a locale badge names its publish state in words, not wire values', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.showLocalesColumn();

        // The badge shows only a slug, so the state reaches a screen reader
        // through the link's name — which means it has to be the *localized*
        // label, not the `EntryStatusView` token behind it. G1's German row is
        // live with edits on top: "Modified", never "modified".
        const g1Row = contentLibraryPage
            .recordRows('Localized posts')
            .filter({ hasText: 'Winter boots' });
        await expect(
            g1Row.getByRole('link', { name: 'Open the de version (Modified)' })
        ).toBeVisible();
        await expect(
            g1Row.getByRole('link', { name: 'Open the en version (Published)' })
        ).toBeVisible();
    });

    test('the switcher search box is a combobox over the locale list', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.localeSwitcher.click();

        // `aria-activedescendant` is only honoured on a role that owns
        // options; on a bare textbox the arrow-key highlight moves silently.
        const search = contentLibraryPage.localeSearch;
        await expect(search).toBeVisible();
        await expect(search).toHaveAttribute('aria-expanded', 'true');
        await expect(search).toHaveAttribute('aria-autocomplete', 'list');
        await expect(search).toHaveAttribute('aria-activedescendant', /.+/);

        // The highlight it points at is a real option, and it follows ↓.
        const first = await search.getAttribute('aria-activedescendant');
        await page.keyboard.press('ArrowDown');
        await expect(search).not.toHaveAttribute(
            'aria-activedescendant',
            first ?? ''
        );
    });

    test('each locale name declares its own language and direction', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.localeSwitcher.click();

        // A locale's display name is written *in* that locale, so a screen
        // reader needs its language to pronounce it — and Arabic needs its
        // direction to order at all. The slugs are BCP-47 tags by contract, so
        // they are the `lang` value verbatim.
        const arabic = contentLibraryPage.localeOption(/العربية/);
        await expect(arabic.locator('[lang="ar"][dir="rtl"]')).toHaveCount(1);
        await expect(
            contentLibraryPage
                .localeOption(/Deutsch/)
                .locator('[lang="de"][dir="ltr"]')
        ).toHaveCount(1);
    });

    test('the entry editor marks the language of the record’s own fields', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.selectLocale(/Deutsch/);
        await contentLibraryPage.localeSwitchSettled();
        await contentLibraryPage.recordLink('Winterstiefel').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // The admin chrome is `<html lang="en">`; without an override the
        // German body is announced with English pronunciation rules. The
        // translated run carries the row's locale — the shared run does not,
        // because its values are one text for every locale.
        await expect(page.locator('[lang="de"]').first()).toBeVisible();
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Winterstiefel'
        );
    });

    test('the entry editor locale switcher shows current / existing / missing', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        // Open the en row of group G1 (which has a de sibling, no fr).
        await contentLibraryPage
            .recordsTable('Localized posts')
            .getByRole('link', { name: /Winter boots/ })
            .click();

        await expect(contentLibraryPage.editorSave).toBeVisible();

        // The chip names the open locale (code + label) and says how much of
        // the group exists — G1 has en + de of four configured locales.
        await expect(contentLibraryPage.editorTitleChip).toHaveText(
            'EN · English2/4'
        );

        await contentLibraryPage.openLocaleMenu();
        // The current locale is the checked radio item.
        await expect(
            contentLibraryPage.localeMenuItem('English')
        ).toHaveAttribute('aria-checked', 'true');
        // The de sibling exists → switch; fr is missing → create.
        await expect(contentLibraryPage.switchLocale('Deutsch')).toBeVisible();
        await expect(
            contentLibraryPage.createTranslation('Français')
        ).toBeVisible();
        // Each existing sibling carries its publish state.
        await expect(
            contentLibraryPage.switchLocale('Deutsch')
        ).toContainText(/Published|Draft|Modified/);
        await contentLibraryPage.closeLocaleMenu();

        // The record's translation-group id is a row of **Details**, with an
        // info affordance explaining what it is — not a rail block of its own.
        await expect(contentLibraryPage.localeGroupLabel).toBeVisible();
        await expect(contentLibraryPage.localeGroupHelp).toBeVisible();
        await expect(contentLibraryPage.localeGroupId('G1')).toBeVisible();
    });

    test('the rail carries no Locale block and no Revisions block [ORT-227]', async ({
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // The rail is the publish gate + Details, and the blocks those two
        // replaced are gone: locale switching is the title chip's menu, and an
        // entry's versions are read in the History tab.
        await expect(contentLibraryPage.railBlock('Details')).toBeVisible();
        await expect(contentLibraryPage.railBlock('Locale')).toHaveCount(0);
        await expect(contentLibraryPage.railBlock('Revisions')).toHaveCount(0);
    });

    test('switching to an existing sibling opens that locale row', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage
            .recordsTable('Localized posts')
            .getByRole('link', { name: /Winter boots/ })
            .click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.switchToLocale('Deutsch');

        // The switch flourish plays and carries across the navigation.
        await expect(contentLibraryPage.localeSwitchOverlay).toHaveText(
            /Switching to Deutsch/
        );
        await expect(page).toHaveURL(/\/localized_post\/lp-de-1$/);
        // The title chip follows the open locale.
        await expect(contentLibraryPage.editorTitleChip).toHaveText(
            'DE · Deutsch2/4'
        );
    });

    test('selecting a missing locale opens a prefilled draft form', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage
            .recordsTable('Localized posts')
            .getByRole('link', { name: /Winter boots/ })
            .click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.startTranslation('Français');

        // Lands on a create form scoped to the target locale + the same group.
        await expect(page).toHaveURL(/\/localized_post\/new\?/);
        await expect(page).toHaveURL(/locale=fr/);
        await expect(page).toHaveURL(/localeGroupId=G1/);

        // Shared (non-localized) fields are prefilled from the source; the
        // localized Title starts blank for the translator, and shows the
        // localizable indicator.
        await expect(page.getByLabel('Category')).toContainText('guide');
        await expect(page.getByLabel(/Title/)).toHaveValue('');
        await expect(page.getByText('Localized field').first()).toBeAttached();
    });

    test('a brand-new record can be re-targeted to another locale before saving', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.addRecord.click();

        // The create form starts in the default locale; the widget is live even
        // though nothing is saved yet.
        await expect(page).toHaveURL(/\/localized_post\/new$/);
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // The chip shows the default locale. Nothing of this record exists yet,
        // so none of the four locales is translated.
        await expect(contentLibraryPage.editorTitleChip).toHaveText(
            'EN · English0/4'
        );

        // Switch the form's target locale to German (no group yet — a fresh
        // record, just re-scoped).
        await contentLibraryPage.startTranslation('Deutsch');

        await expect(page).toHaveURL(/\/localized_post\/new\?/);
        await expect(page).toHaveURL(/locale=de/);
        await expect(page).not.toHaveURL(/localeGroupId=/);
    });

    test('a translation draft can jump to an existing sibling', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage
            .recordsTable('Localized posts')
            .getByRole('link', { name: /Winter boots/ })
            .click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // Start a French translation of group G1 (which already has en + de).
        await contentLibraryPage.startTranslation('Français');
        await expect(page).toHaveURL(/localeGroupId=G1/);
        await contentLibraryPage.localeSwitchSettled();

        // On that draft form the chip still knows the group's members, so the
        // existing German sibling is a switch target.
        await contentLibraryPage.switchToLocale('Deutsch');
        await expect(page).toHaveURL(/\/localized_post\/lp-de-1$/);
    });

    test('picking a locale with unsaved edits asks first, then completes', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // Dirty the form. A switch leaves this record for another, so these
        // edits are about to be thrown away.
        await contentLibraryPage.fieldTextbox('Title').fill('Winter boots v2');

        await contentLibraryPage.switchToLocale('Deutsch');

        // The prompt is the app-wide one, rendered by `UnsavedChangesProvider`
        // at app level — which is what lets it outlive the menu that raised it.
        // A dialog owned by the menu would unmount with it, and the pick would
        // be silently dropped.
        await expect(contentLibraryPage.unsavedChangesDialog).toBeVisible();
        await contentLibraryPage.confirmDiscardChanges();

        // Confirming still completes the navigation: the switch was scheduled
        // behind the cover, and nothing in the closing menu may cancel it.
        await contentLibraryPage.localeSwitchSettled();
        await expect(page).toHaveURL(/\/localized_post\/lp-de-1$/);
    });

    test('declining the unsaved-changes prompt keeps the record and its edits', async ({
        page,
        contentLibraryPage
    }) => {
        await openCollection(contentLibraryPage);
        await contentLibraryPage.recordLink('Winter boots').click();
        await expect(contentLibraryPage.editorSave).toBeVisible();
        await contentLibraryPage.fieldTextbox('Title').fill('Winter boots v2');

        await contentLibraryPage.switchToLocale('Deutsch');
        await contentLibraryPage.unsavedChangesDialog
            .getByRole('button', { name: 'Keep editing' })
            .click();

        await expect(page).toHaveURL(/\/localized_post\/lp-en-1$/);
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            'Winter boots v2'
        );
    });

    test('the relation picker on a translation-create form is scoped to that locale [i18n:I-31]', async ({
        page,
        relationsEditorPage
    }) => {
        // A brand-new German translation draft — no saved entry, the locale
        // lives only in the URL.
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/new?locale=de&localeGroupId=G1`
        );
        await relationsEditorPage.openRelationsTab();

        // Opening the "Related post" picker (target is an i18n type) must scope
        // candidates to the create form's locale (de) — not the default — even
        // though there's no saved entry to read the locale from.
        const candidates = page.waitForRequest(
            (req) =>
                req.url().includes('/api/content/localized_post') &&
                /[?&]locale=de(&|$)/.test(req.url())
        );
        await relationsEditorPage.selectButton('Localized posts').click();
        await expect(relationsEditorPage.dialog).toBeVisible();
        await candidates;
    });

    /**
     * Regression: creating a record in one locale and then, **without leaving the
     * editor**, switching to another locale and saving must create a **new
     * sibling** (a POST to the collection), not re-use the just-created record's
     * id (a PATCH that overwrites it and creates no translation). The editor is
     * reused — not remounted — across `/new` → `/:id` → `/new?locale=…`, so the
     * save flow must forget the prior create id when the target locale changes.
     * See `usePublishEntryFlow` (`editorKey`) + `ContentEntryView`.
     */
    test.describe('save after switching locale on a fresh record', () => {
        /** The bare-collection create POSTs (a new record / sibling). */
        const creates = (writes: EntryWrite[]) =>
            writes.filter((write) => write.isCreate);
        /** Any update PATCH — the symptom of the bug when it re-homes a sibling. */
        const patches = (writes: EntryWrite[]) =>
            writes.filter((write) => write.method === 'PATCH');

        /**
         * Create a fresh record in the default locale via "Save draft", landing on
         * its own editor URL. Returns the write spy for the caller's assertions.
         */
        async function createEnglishDraft(
            page: Page,
            contentLibraryPage: ContentLibraryPage
        ): Promise<EntryWrite[]> {
            const writes = spyEntryWrites(page);
            await contentLibraryPage.goto(I18N_WORKSPACE.id);
            await contentLibraryPage.typeLink('Localized posts').click();
            await contentLibraryPage.addRecord.click();
            await expect(page).toHaveURL(/\/localized_post\/new$/);

            await contentLibraryPage.fieldTextbox('Title').fill('Winter boots');
            await contentLibraryPage.saveDraft();

            // The create POST lands the editor on the new record's own URL,
            // and the saved record's locale menu offers the missing German one.
            await expect(page).toHaveURL(/\/localized_post\/lp-en-new$/);
            await contentLibraryPage.openLocaleMenu();
            await expect(
                contentLibraryPage.createTranslation('Deutsch')
            ).toBeVisible();
            await contentLibraryPage.closeLocaleMenu();
            return writes;
        }

        test('saving as draft creates a sibling, never a PATCH on the original', async ({
            page,
            contentLibraryPage
        }) => {
            const writes = await createEnglishDraft(page, contentLibraryPage);

            // Switch to the (missing) German locale — a fresh create form for the
            // same translation group, on the reused editor.
            await contentLibraryPage.startTranslation('Deutsch');
            await expect(page).toHaveURL(/\/localized_post\/new\?/);
            await expect(page).toHaveURL(/locale=de/);
            // The switch cover holds the page inert until the destination has
            // loaded, so typing before it lifts goes nowhere.
            await contentLibraryPage.localeSwitchSettled();

            await contentLibraryPage
                .fieldTextbox('Title')
                .fill('Winterstiefel');
            await contentLibraryPage.saveDraft();

            // The save creates the German sibling and moves to *its* URL — not a
            // silent no-op stuck on `/new`, and not the English row's URL. The
            // active locale rides along on that URL, so the editor still knows
            // which list to send the user back to.
            await expect(page).toHaveURL(
                /\/localized_post\/lp-de-new\?.*locale=de/
            );

            // Two creates (en, then de); the German save is a POST carrying its
            // own locale — and crucially there is **no PATCH** re-homing the row.
            expect(patches(writes)).toHaveLength(0);
            expect(creates(writes)).toHaveLength(2);
            expect(creates(writes).at(-1)?.body?.locale).toBe('de');
        });

        test('publishing creates a sibling, never a PATCH on the original', async ({
            page,
            contentLibraryPage
        }) => {
            const writes = await createEnglishDraft(page, contentLibraryPage);

            await contentLibraryPage.startTranslation('Deutsch');
            await expect(page).toHaveURL(/locale=de/);
            await contentLibraryPage.localeSwitchSettled();

            await contentLibraryPage
                .fieldTextbox('Title')
                .fill('Winterstiefel');
            // The primary action is "Publish" (publishable type, admin may
            // publish) — create-then-publish, both against the new sibling.
            await contentLibraryPage.editorSave.click();

            await expect(page).toHaveURL(
                /\/localized_post\/lp-de-new\?.*locale=de/
            );

            // The German create is still a POST (not a PATCH on the English id),
            // followed by a publish POST on the *new* row.
            expect(patches(writes)).toHaveLength(0);
            expect(creates(writes)).toHaveLength(2);
            expect(creates(writes).at(-1)?.body?.locale).toBe('de');
            expect(
                writes.some(
                    (write) =>
                        write.method === 'POST' &&
                        write.path.endsWith('/lp-de-new/publish')
                )
            ).toBe(true);
        });
    });

    /**
     * The two `ENTRY_MENU_SLOT` contributions — acting on **every locale of the
     * open record at once**. Both reuse the content library's own bulk
     * endpoints (the siblings are entries of the same type), so what's asserted
     * here is the wiring: which locales are gathered, how they're named, and
     * that the actions only appear where they mean something.
     */
    test.describe('All-locales actions', () => {
        /** Open the `en` row of group G1 — it has a published `de` sibling. */
        async function openGroupedRow(
            contentLibraryPage: ContentLibraryPage
        ): Promise<void> {
            await openCollection(contentLibraryPage);
            await contentLibraryPage.recordLink('Winter boots').click();
            await expect(contentLibraryPage.editorSave).toBeVisible();
        }

        test('the ⋯ menu groups the built-ins and the locale actions', async ({
            contentLibraryPage
        }) => {
            await openGroupedRow(contentLibraryPage);
            await contentLibraryPage.openEditorMenu();

            // save · publish · extras · danger, in that order. "Export…" is
            // `transfer-admin`'s slot contribution, which lands in the same
            // Extras group as the locale actions — so it adds an item here but
            // no fourth separator.
            await expect(contentLibraryPage.editorMenuItems).toHaveText([
                'Save draft',
                'Save & publish',
                'Unpublish',
                'Publish all locales',
                'Unpublish all locales',
                'Export…',
                'Delete'
            ]);
            // One rule between each pair of adjacent groups.
            await expect(contentLibraryPage.editorMenuSeparators).toHaveCount(
                3
            );
        });

        test('publish all locales pre-flights every sibling, named by locale', async ({
            contentLibraryPage
        }) => {
            await openGroupedRow(contentLibraryPage);
            await contentLibraryPage.openEditorMenu();
            await contentLibraryPage.chooseEditorAction('Publish all locales');

            // Rows are named by **locale**, not by the record title — every
            // sibling carries the same title, so titles couldn't tell them apart.
            await expect(
                contentLibraryPage.preflightRow('English')
            ).toContainText('Already published');
            await expect(
                contentLibraryPage.preflightRow('Deutsch')
            ).toContainText('Will publish');

            // Only the draft sibling is publishable, and confirming says so.
            await expect(contentLibraryPage.preflightConfirm).toHaveText(
                'Publish 1 valid'
            );
            await contentLibraryPage.preflightConfirm.click();
            await expect(
                contentLibraryPage.toast('1 record published.')
            ).toBeVisible();
        });

        test('publishing all locales refreshes the open record’s own status', async ({
            contentLibraryPage
        }) => {
            // Open the German sibling: published once and edited since, so the
            // Details block reads **Modified** — the state you publish from.
            await openCollection(contentLibraryPage);
            await contentLibraryPage.selectLocale(/Deutsch/);
            await contentLibraryPage.localeSwitchSettled();
            await contentLibraryPage.recordLink('Winterstiefel').click();
            await expect(contentLibraryPage.editorSave).toBeVisible();
            await expect(contentLibraryPage.entryDetailsStatus).toHaveText(
                'Modified'
            );

            await contentLibraryPage.openEditorMenu();
            await contentLibraryPage.chooseEditorAction('Publish all locales');
            await contentLibraryPage.preflightConfirm.click();
            await expect(
                contentLibraryPage.toast('1 record published.')
            ).toBeVisible();

            // The bulk action published the record the editor is *showing*, so
            // its own read-one has to be refreshed too — refreshing only the
            // records list left this badge reading Modified for a record that
            // had just gone live.
            await expect(contentLibraryPage.entryDetailsStatus).toHaveText(
                'Published'
            );
        });

        test('unpublish all locales confirms, naming the live locales', async ({
            contentLibraryPage
        }) => {
            await openGroupedRow(contentLibraryPage);
            await contentLibraryPage.openEditorMenu();
            await contentLibraryPage.chooseEditorAction(
                'Unpublish all locales'
            );

            // Only `en` is live in the seed, so only it is named.
            const dialog = contentLibraryPage.preflightDialog;
            await expect(dialog).toContainText('Unpublish 1 live locale?');
            await expect(dialog).toContainText('This takes English offline.');
        });

        test('neither action is offered on an unsaved record', async ({
            contentLibraryPage
        }) => {
            await contentLibraryPage.gotoNewEntry(
                I18N_WORKSPACE.id,
                'localized_post'
            );
            await expect(contentLibraryPage.editorSave).toBeVisible();
            await contentLibraryPage.openEditorMenu();

            // A create form has no siblings to act on — and nothing to delete.
            await expect(contentLibraryPage.editorMenuItems).toHaveText([
                'Save draft',
                'Save & publish'
            ]);
        });
    });
});
