import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries
} from '../support/api/content';
import { mockTransferExport } from '../support/api/transfer';
import { type ContentLibraryPage } from '../support/pages/ContentLibraryPage';
import { type TransferPage } from '../support/pages/TransferPage';

/**
 * The export dialog (`@orthacms/transfer-admin`), opened from the records
 * selection bar.
 *
 * What the graph walk puts in the file is settled server-side. What is only
 * observable here is the **offer**: which options a format allows, what the
 * numbers under them say, and that the dialog outlives the menu it was opened
 * from — the contribution's overlay is rendered outside `DropdownMenuContent`,
 * which unmounts the instant the menu closes, which is exactly when the dialog
 * is meant to appear.
 */

const RECORDS_URL = `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post`;
const AT = '2026-01-01T00:00:00.000Z';

/** One seeded row, in the shape `GET /api/content/:name` returns. */
function row(id: string, title: string) {
    return {
        id,
        status: 'published' as const,
        createdAt: AT,
        updatedAt: AT,
        values: { title }
    };
}

test.describe('Content export dialog', () => {
    test.beforeEach(async ({ page, contentLibraryPage }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });
        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();
    });

    /** Select the one row and open the dialog from the selection bar's ⋯. */
    async function openDialog(
        contentLibraryPage: ContentLibraryPage,
        transferPage: TransferPage
    ) {
        await contentLibraryPage.rowCheckbox('Blog posts', 0).click();
        await transferPage.openExportDialogFromSelection();
        await expect(transferPage.exportDialog).toBeVisible();
    }

    test('offers file bytes only in a format that can carry them [transfer:I-33]', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // One capability table decides this for the server and the interface
        // alike, so the toggle is disabled — and reads as off — rather than
        // being accepted and quietly ignored. Every text format is walked, not
        // just CSV: a dialog that special-cased the lossy format would leave
        // "Files" live for JSON and promise bytes no JSON document can hold.
        const spy = await mockTransferExport(page);
        await openDialog(contentLibraryPage, transferPage);

        // ZIP is the default, and the only format that carries bytes.
        await expect(transferPage.includeToggle('Files')).toBeEnabled();
        await expect(transferPage.includeToggle('Files')).toBeChecked();

        for (const format of ['JSON', 'JSON Lines', 'CSV (flat)']) {
            await transferPage.chooseFormat(format);
            await expect(transferPage.includeToggle('Files')).toBeDisabled();
            await expect(transferPage.includeToggle('Files')).not.toBeChecked();
        }

        // CSV says the two things only CSV has to say: it is lossy, and one
        // file per type means a multi-type download is a ZIP of tables.
        await expect(transferPage.lossyNote).toBeVisible();
        await expect(transferPage.multiFileNote).toBeVisible();

        // Back to ZIP: the choice is restored rather than lost on the way.
        await transferPage.chooseFormat('ZIP archive (with files)');
        await expect(transferPage.includeToggle('Files')).toBeEnabled();
        await expect(transferPage.includeToggle('Files')).toBeChecked();
        await expect(transferPage.lossyNote).toHaveCount(0);

        // The preflight is asked what will actually happen: no text format ever
        // asked the server for media, which is the difference between disabling
        // the toggle and merely greying it out.
        expect(spy.previews.length).toBeGreaterThan(0);
        for (const request of spy.previews) {
            expect(request.depth.media).toBe(request.format === 'zip');
        }
    });

    test('the counts follow the toggles, and relation languages need relations', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The counts are the only warning that "include related records" is the
        // difference between 40 records and 4,000, so they have to move with
        // the toggles rather than describe the options the dialog opened on.
        const spy = await mockTransferExport(page);
        await openDialog(contentLibraryPage, transferPage);

        await expect(transferPage.exportCounts).toHaveText(
            /1 record, 4 related, 2 files/
        );
        await expect(
            transferPage.includeToggle('Languages of related records')
        ).toBeEnabled();

        await transferPage.includeToggle('Related records').click();

        // Nothing related is coming, so their languages cannot mean anything.
        await expect(
            transferPage.includeToggle('Languages of related records')
        ).toBeDisabled();
        await expect(transferPage.exportCounts).toHaveText(/0 related/);
        expect(spy.previews[spy.previews.length - 1].depth.relations).toBe(
            false
        );
    });

    test('a preflight that failed says so, and the export still runs', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // Not being able to count is not a reason to refuse the export: the
        // walk that failed here is the estimate, not the file. A `4xx` so the
        // query settles at once — the shared client retries `5xx` three times.
        await mockTransferExport(page, { previewStatus: 400 });
        await openDialog(contentLibraryPage, transferPage);

        await expect(transferPage.exportCounts).toHaveText(/work out the size/);
        await expect(transferPage.exportConfirm).toBeEnabled();
    });

    test('the selection survives until the download has happened', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The selection bar unmounts the moment the selection is empty, and it
        // owns this dialog — so clearing on open would take the dialog with it.
        // It clears on success, and not before.
        const spy = await mockTransferExport(page);
        await openDialog(contentLibraryPage, transferPage);
        await expect(contentLibraryPage.selectionCount).toHaveText(
            '1 selected'
        );

        await transferPage.exportConfirm.click();

        await expect(
            contentLibraryPage.toast(/Exported 1 record to export\.zip/)
        ).toBeVisible();
        await expect(transferPage.exportDialog).toHaveCount(0);
        await expect(contentLibraryPage.selectionCount).toHaveCount(0);
        expect(spy.downloads).toHaveLength(1);
        expect(spy.downloads[0].ids).toEqual(['post-1']);
    });
});
