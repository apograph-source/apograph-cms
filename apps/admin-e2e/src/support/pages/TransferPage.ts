import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for `@orthacms/transfer-admin` — the export and import dialogs,
 * and the three Content Library seams that reach them.
 *
 * The plugin contributes **no route of its own**: everything it does is an
 * action on content someone is already looking at, so every handle here is
 * reached from a collection's records page (or an entry's editor) rather than
 * from a URL. Seed it with the `content` mocks plus `support/api/transfer`.
 */
export class TransferPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    // --- the three seams -----------------------------------------------------

    /**
     * The collection's ⋯ menu in the records header — where **Import…** lives.
     *
     * The entry editor's own ⋯ carries the same accessible name, but the two
     * never appear on the same screen: this one belongs to the records list.
     */
    get collectionMenu(): Locator {
        return this.page.getByRole('button', { name: 'More actions' });
    }

    /** The selection bar's ⋯ menu — where the bulk **Export** lives. */
    get bulkMenu(): Locator {
        return this.page.getByRole('button', { name: 'Bulk actions' });
    }

    /** An open menu's item, by exact label. */
    menuItem(label: string): Locator {
        return this.page.getByRole('menuitem', { name: label, exact: true });
    }

    /** Open the collection ⋯ menu and choose **Import…**. */
    async openImportDialog(): Promise<void> {
        await this.collectionMenu.click();
        await this.menuItem('Import…').click();
    }

    /** Open the selection bar's ⋯ menu and choose **Export**. */
    async openExportDialogFromSelection(): Promise<void> {
        await this.bulkMenu.click();
        await this.menuItem('Export').click();
    }

    // --- the export dialog ---------------------------------------------------

    /** The export dialog, named by its title ("Export 1 record"). */
    get exportDialog(): Locator {
        return this.page.getByRole('dialog', { name: /^Export \d+ record/ });
    }

    /** The format select's trigger. */
    get formatSelect(): Locator {
        return this.exportDialog.getByRole('combobox', { name: 'Format' });
    }

    /** Choose an export format by the label the dialog offers it under. */
    async chooseFormat(label: string): Promise<void> {
        await this.formatSelect.click();
        // The listbox is portalled out of the dialog, so it is located on the
        // page rather than inside `exportDialog`.
        await this.page
            .getByRole('option', { name: label, exact: true })
            .click();
    }

    /**
     * One **Include** toggle by its exact label.
     *
     * Exact, because Playwright's string match is a case-insensitive substring
     * and "Related records" would otherwise also resolve to "Languages of
     * related records" — a strict-mode failure rather than an assertion.
     */
    includeToggle(label: string): Locator {
        return this.exportDialog.getByRole('checkbox', {
            name: label,
            exact: true
        });
    }

    /**
     * The live counts line under the toggles.
     *
     * Located by its `aria-live`, which is the point of the element: the numbers
     * change as the toggles move, and a screen-reader user choosing options gets
     * the same feedback a sighted one reads off the line.
     */
    get exportCounts(): Locator {
        return this.exportDialog.locator('p[aria-live="polite"]');
    }

    /**
     * The note a **lossy** format carries — CSV flattens rich text, links and
     * files, and saying so is the difference between an informed choice and a
     * surprise in the file.
     */
    get lossyNote(): Locator {
        return this.exportDialog.getByText(/CSV is a flat table/);
    }

    /** The note that a multi-type CSV download arrives as a ZIP of tables. */
    get multiFileNote(): Locator {
        return this.exportDialog.getByText(
            /Several types export as separate files/
        );
    }

    /** The export dialog's confirm button. */
    get exportConfirm(): Locator {
        return this.exportDialog.getByRole('button', {
            name: 'Export',
            exact: true
        });
    }

    // --- the import dialog ---------------------------------------------------

    /** The import dialog, named by its title. */
    get importDialog(): Locator {
        return this.page.getByRole('dialog', { name: 'Import records' });
    }

    /** The dialog's file input. */
    get fileInput(): Locator {
        return this.importDialog.locator('input[type="file"]');
    }

    /** Choose a file to import — the name is what the request carries. */
    async chooseFile(name: string, contents = '{"records":[]}'): Promise<void> {
        await this.fileInput.setInputFiles({
            name,
            mimeType: 'application/json',
            buffer: Buffer.from(contents)
        });
    }

    /**
     * One policy option, by (part of) its label. Both questions are radio
     * groups of the same shape, so one handle serves both — a `RegExp` avoids
     * spelling the typographic apostrophes the labels are written with.
     */
    policyOption(label: string | RegExp): Locator {
        return this.importDialog.getByRole('radio', { name: label });
    }

    /** The phase-one button: run the dry run. */
    get checkButton(): Locator {
        return this.importDialog.getByRole('button', {
            name: /Check the file|Checking/
        });
    }

    /** The phase-two confirm — present only once a dry run has answered. */
    get importButton(): Locator {
        return this.importDialog.getByRole('button', {
            name: 'Import',
            exact: true
        });
    }

    /** The phase-two "start over with another file" button. */
    get chooseAnotherFile(): Locator {
        return this.importDialog.getByRole('button', {
            name: 'Choose another file'
        });
    }

    /** The per-record verdict table — the thing that must go stale. */
    get verdictTable(): Locator {
        return this.importDialog.getByRole('table');
    }

    /** One verdict row, by the record's label. */
    verdictRow(label: string): Locator {
        return this.verdictTable.getByRole('row').filter({ hasText: label });
    }

    /** The counts line above the table ("1 to add · 1 to update · …"). */
    get importSummary(): Locator {
        return this.importDialog.getByText(/to add ·/);
    }

    /** The "nothing here would change" banner a pure-skip run raises. */
    get nothingToDoBanner(): Locator {
        return this.importDialog.getByText(
            /Nothing in this file would change anything here/
        );
    }

    /**
     * The dialog's own error alert — what the server said about a refused check
     * or a refused apply, shown verbatim rather than as "that didn't work".
     *
     * `role="alert"` is shared with the "nothing would change" banner (both are
     * the design-system `Alert`), and the two never appear together: a run that
     * produced a banner produced verdicts, and an error clears them.
     */
    get importError(): Locator {
        return this.importDialog.getByRole('alert');
    }

    /**
     * Pick a file and run the dry run, leaving the dialog in phase two.
     *
     * The wait is on the table rather than on the request: the verdicts are
     * what every assertion here is about, and a spec that continued while the
     * dialog was still in phase one would be asserting about the wrong screen.
     */
    async checkFile(name: string): Promise<void> {
        await this.chooseFile(name);
        await this.checkButton.click();
        await this.verdictTable.waitFor();
    }
}
