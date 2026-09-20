import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Media Library at `/workspaces/:id/media` (from
 * `@orthacms/media-admin`) — the folders sidebar, the asset browser (grid), and
 * the New-folder / Upload flows. Seed it with `mockSignedIn`, `mockWorkspaces`,
 * and `mockMediaApi`.
 */
export class MediaLibraryPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    /** Navigate straight to a workspace's Media Library. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/media`);
    }

    /** The page heading ("Media Library" at the root). */
    heading(): Locator {
        return this.page.getByRole('heading', { name: 'Media Library' });
    }

    /** An asset tile by file name (its "Open {name}" button). */
    assetTile(name: string): Locator {
        return this.page.getByRole('button', { name: `Open ${name}` });
    }

    /** A folder tile by name (its "Open folder {name}" button). */
    folderTile(name: string): Locator {
        return this.page.getByRole('button', { name: `Open folder ${name}` });
    }

    /** The no-access message shown without `media:read`. */
    noAccess(): Locator {
        return this.page.getByText(/permission to view the media library/);
    }

    /** A toast by its text (sonner posts into the shell's live region). */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    /**
     * The focusable region wrapping the folder/asset grid. A destructive action
     * hands focus here, since the ⋯ trigger it was restored to no longer exists.
     */
    assetsRegion(): Locator {
        return this.page.getByRole('region', { name: 'Assets' });
    }

    // --- asset actions ---

    /**
     * The per-asset "⋯" menu trigger, named after its file — a grid of tiles
     * would otherwise offer N buttons all called "Asset actions".
     */
    assetActions(name: string): Locator {
        return this.page.getByRole('button', { name: `Actions for ${name}` });
    }

    /** Open an asset's menu and choose an item. */
    async assetAction(name: string, item: string) {
        await this.assetActions(name).click();
        await this.page.getByRole('menuitem', { name: item }).click();
    }

    /** Rename an asset through its ⋯ menu. */
    async renameAsset(name: string, to: string) {
        await this.assetAction(name, 'Rename');
        // `getByLabel('Name')` also matches the dialog itself, whose accessible
        // name is "Rename". Anchor on the textbox role.
        await this.page.getByRole('textbox', { name: 'Name' }).fill(to);
        await this.page.getByRole('button', { name: 'Save' }).click();
    }

    /** Delete an asset through its ⋯ menu, confirming the dialog. */
    async deleteAsset(name: string) {
        await this.assetAction(name, 'Delete');
        await this.confirmDelete();
    }

    // --- detail drawer ---

    /** Open an asset's detail drawer from its tile. */
    async openDetail(name: string) {
        await this.assetTile(name).click();
    }

    /** The drawer's alt-text input (present for an image with `media:update`). */
    altInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Alt text' });
    }

    /** Save the drawer's alt text. */
    async saveAlt(text: string) {
        await this.altInput().fill(text);
        await this.page.getByRole('button', { name: 'Save alt text' }).click();
    }

    // --- upload banner ---

    /** The upload progress banner. */
    uploadBanner(): Locator {
        return this.page.getByRole('region', { name: 'Uploads' });
    }

    /** The alt input on a staged file in the upload dialog. */
    stagedAltInput(fileName: string): Locator {
        return this.page.getByRole('textbox', {
            name: `Alt text for ${fileName}`
        });
    }

    // --- upload ---

    /** The hidden file input inside the upload dialog. */
    fileInput(): Locator {
        return this.page.locator('input[type="file"]');
    }

    /** Open the upload dialog. */
    async openUpload() {
        await this.page.getByRole('button', { name: 'Upload' }).first().click();
    }

    /** Stage a file and confirm the upload, optionally describing it first. */
    async uploadFile(
        file: { name: string; mimeType: string; buffer: Buffer },
        alt?: string
    ) {
        await this.fileInput().setInputFiles(file);
        if (alt !== undefined) await this.stagedAltInput(file.name).fill(alt);
        await this.page
            .getByRole('button', { name: /^Upload \d+ file/ })
            .click();
    }

    // --- folder actions ---

    /**
     * The per-folder "⋯" menu trigger. Named after its folder ("Actions for
     * Images"), so it needs no positional scoping — and a screen-reader user
     * isn't handed a row of identical "Folder actions" buttons.
     */
    folderActions(name: string): Locator {
        return this.page.getByRole('button', { name: `Actions for ${name}` });
    }

    /** Open a folder's menu and choose Delete — stops at the confirmation. */
    async startDeleteFolder(name: string) {
        await this.folderActions(name).click();
        await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    }

    /**
     * The open confirm dialog (a plain `dialog` — the design-system
     * `ConfirmDialog` builds on `Dialog`, not `AlertDialog`). Its title varies
     * with what the folder holds, so match on the heading role, not the text.
     */
    get confirmDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /** Confirm the pending destructive action. */
    async confirmDelete() {
        await this.confirmDialog
            .getByRole('button', { name: 'Delete', exact: true })
            .click();
    }

    // --- new folder ---

    /** Run the create-folder flow end to end. */
    async createFolder(name: string) {
        await this.page
            .getByRole('button', { name: 'New folder' })
            .first()
            .click();
        await this.page.getByLabel('Folder name').fill(name);
        await this.page.getByRole('button', { name: 'Create folder' }).click();
    }
}
