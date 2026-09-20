import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the entry editor's **Media** tab — the media plugin's
 * `ENTRY_TAB_SLOT` contribution (`@orthacms/media-admin`): one card per media
 * field, each with attached-asset tiles, the library picker, and the upload
 * dialog. Drives the create editor at `/workspaces/:id/content/article/new`.
 *
 * Seed with `mockSignedIn`, `mockWorkspaces`, the `MEDIA_FIELDS_*` content mocks
 * (their schema is what makes the tab appear), `mockEntryMedia`, and
 * `mockMediaApi` — the picker and the upload both go to the real media
 * endpoints.
 */
export class MediaFieldPage extends BasePage {
    /** The editor's Media tab trigger. */
    readonly mediaTab: Locator;
    /** The library picker dialog (single or multiple mode). */
    readonly pickerDialog: Locator;
    /** The upload dialog — the Media Library's own, reused by the field. */
    readonly uploadDialog: Locator;

    constructor(page: Page) {
        super(page);
        this.mediaTab = page.getByRole('tab', { name: 'Media' });
        this.pickerDialog = page.getByRole('dialog', {
            name: /^Select an? asset|^Select assets/
        });
        this.uploadDialog = page.getByRole('dialog', { name: 'Upload assets' });
    }

    /** Open the create editor for the seeded `article` collection. */
    async gotoNewArticle(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/content/article/new`);
    }

    /** Open an existing record's editor. */
    async gotoArticle(workspaceId: string, entryId: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/content/article/${entryId}`
        );
    }

    /** Switch to the Media tab. */
    async openMediaTab() {
        await this.mediaTab.click();
    }

    /** A media field's card heading, by its admin label. */
    section(label: string): Locator {
        return this.page.getByText(label, { exact: true });
    }

    /** The empty state of a single field ("No asset selected"). */
    get emptySingle(): Locator {
        return this.page.getByText('No asset selected');
    }

    /** The empty state of a multiple field ("No assets attached"). */
    get emptyMultiple(): Locator {
        return this.page.getByText('No assets attached');
    }

    // --- the field's own controls -------------------------------------------

    /**
     * A field's library trigger. Its label states the effect: "Select from
     * library" (empty single) / "Replace" (filled single) / "Add from library"
     * (multiple).
     */
    libraryButton(
        name: 'Select from library' | 'Replace' | 'Add from library'
    ): Locator {
        return this.page.getByRole('button', { name });
    }

    /** A field's Upload trigger — scoped to the card holding `fieldLabel`. */
    uploadButton(fieldLabel: string): Locator {
        return this.fieldCard(fieldLabel).getByRole('button', {
            name: 'Upload'
        });
    }

    /**
     * The card wrapping one media field — the design-system `Field`, which is a
     * `role="group"`, narrowed to the one holding this label. Scoping matters
     * here: both fields render a button called "Upload".
     */
    fieldCard(fieldLabel: string): Locator {
        // `.last()` because the app-wide scrollport is a named `role="group"`
        // now (`ORT-150`), and it is an **ancestor** of every field on the page
        // — so an unscoped `getByRole('group')` filtered by a field's label
        // matches the scrollport as well as the card. DOM order puts the
        // ancestor first, so the innermost match is the card.
        return this.page
            .getByRole('group')
            .filter({ has: this.page.getByText(fieldLabel, { exact: true }) })
            .last();
    }

    /** An attached asset's remove button, by the asset's file name. */
    removeAsset(name: string): Locator {
        return this.page.getByRole('button', { name: `Remove ${name}` });
    }

    /** Reorder controls on an attached asset (multiple fields only). */
    moveAssetUp(name: string): Locator {
        return this.page.getByRole('button', { name: `Move ${name} up` });
    }
    moveAssetDown(name: string): Locator {
        return this.page.getByRole('button', { name: `Move ${name} down` });
    }

    /**
     * Every attached tile's file name, in DOM order — i.e. the stored order of a
     * multiple field. The name paragraph is the one carrying a `title`
     * (the tooltip for a truncated name), which the meta line beneath it lacks.
     */
    async attachedNames(fieldLabel: string): Promise<string[]> {
        return this.fieldCard(fieldLabel)
            .locator('li p[title]')
            .allInnerTexts();
    }

    /** The note shown when the user can't reach the Media Library at all. */
    get noMediaAccess(): Locator {
        // `.first()`: every media field on the type carries the note.
        return this.page
            .getByText('You don’t have access to the Media Library', {
                exact: false
            })
            .first();
    }

    /** The placeholder a tile shows while its asset ref is still in flight. */
    get resolvingTile(): Locator {
        return this.page.getByText('Loading asset…').first();
    }

    /** Every `<img>` on the page pointing at an asset's raw route. */
    get rawImages(): Locator {
        return this.page.locator('img[src*="/raw"]');
    }

    /**
     * The "Uploads on save" marker a staged (not yet uploaded) tile carries.
     * Exact, or it also matches the footer's "1 file uploads on save" (text
     * matching is substring **and** case-insensitive).
     */
    get pendingMarker(): Locator {
        return this.page.getByText('Uploads on save', { exact: true });
    }

    /** The footer note counting files that will upload with the record. */
    get pendingCount(): Locator {
        return this.page.getByText(/uploads? on save$/);
    }

    // --- the library picker --------------------------------------------------

    /** A candidate tile in the picker, by its file name. */
    pickerTile(name: string): Locator {
        return this.pickerDialog.getByRole('button', {
            name: new RegExp(name.replace('.', '\\.'))
        });
    }

    /** The picker's "couldn't load" state — distinct from its empty state. */
    get pickerLoadError(): Locator {
        return this.pickerDialog.getByText('Couldn’t load the library');
    }

    /** The picker's retry control. */
    get pickerRetry(): Locator {
        return this.pickerDialog.getByRole('button', { name: 'Try again' });
    }

    /** The picker's search box. */
    get pickerSearch(): Locator {
        return this.pickerDialog.getByRole('searchbox', {
            name: 'Search assets'
        });
    }

    /** A folder chip in the picker (descends into that folder). */
    pickerFolder(name: string): Locator {
        return this.pickerDialog.getByRole('button', { name });
    }

    /**
     * The picker's breadcrumb back to the library root. A **button**, not a link
     * — folder navigation is component state, not a route.
     */
    get pickerRootCrumb(): Locator {
        return this.pickerDialog.getByRole('button', { name: 'All media' });
    }

    /** The picker's confirm button ("Select asset" / "Add selected"). */
    get pickerConfirm(): Locator {
        return this.pickerDialog.getByRole('button', {
            name: /^(Select asset|Add selected)$/
        });
    }

    /** Pick one asset by name and confirm. */
    async pickAsset(name: string) {
        await this.pickerTile(name).click();
        await this.pickerConfirm.click();
    }

    // --- the upload dialog ---------------------------------------------------

    /** The upload dialog's (visually hidden) file input. */
    get uploadInput(): Locator {
        return this.uploadDialog.locator('input[type="file"]');
    }

    /** The upload dialog's confirm button — "Attach files" in a media field. */
    get uploadConfirm(): Locator {
        return this.uploadDialog.getByRole('button', { name: 'Attach files' });
    }

    /**
     * Stage a file on a field: open its Upload dialog, choose the file, confirm.
     * Nothing is uploaded here — the bytes go up when the record is saved.
     */
    async stageUpload(
        fieldLabel: string,
        name: string,
        mimeType = 'image/png'
    ) {
        await this.uploadButton(fieldLabel).click();
        await this.uploadInput.setInputFiles({
            name,
            mimeType,
            buffer: Buffer.from('fake-bytes')
        });
        await this.uploadConfirm.click();
    }

    // --- the editor ----------------------------------------------------------

    /** The editor's primary action (label varies by type/state). */
    get save(): Locator {
        return this.page.getByRole('button', {
            name: /^(Save|Save draft|Save & publish|Publish)$/
        });
    }

    /** The record title input — required, so a save needs it filled. */
    get title(): Locator {
        return this.page.getByRole('textbox', { name: 'Title' });
    }

    /**
     * The alt-text input for one attached asset, named after the asset it
     * describes (`ORT-83` / `ORT-91`).
     */
    altInput(assetName: string): Locator {
        return this.page.getByRole('textbox', {
            name: `Alt text for ${assetName}`
        });
    }

    /** Its "this one is decorative" companion. */
    decorativeToggle(assetName: string): Locator {
        return this.page
            .getByRole('group')
            .filter({ has: this.altInput(assetName) })
            .last()
            .locator('..')
            .getByRole('checkbox', {
                name: 'Decorative — no description needed'
            });
    }

    /** The warning shown while a usage has answered neither question. */
    altMissingWarning(): Locator {
        return this.page.getByText('Needs alt text');
    }
}
