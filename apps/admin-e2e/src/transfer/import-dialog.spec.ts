import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites
} from '../support/api/content';
import {
    IMPORT_NOTHING_TO_DO,
    IMPORT_RUN,
    importCounts,
    mockTransferImport,
    type ImportPreviewSeed
} from '../support/api/transfer';

/**
 * The import dialog (`@orthacms/transfer-admin`), in the collection's ⋯ menu.
 *
 * The mechanics of an import — the depth rule, the natural keys, the verdicts
 * themselves, the revision counts — are pinned against a real database in
 * `apps/server-e2e/src/server/transfer/transfer-round-trip.spec.ts`, and none of
 * that is re-driven here. What only a browser can show is the **dialog**: what
 * the operator is offered, what they are told, and what the screen does when the
 * settings change under a table that was computed from the old ones.
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

/** A one-record run whose single verdict carries the given label. */
function runNaming(label: string): ImportPreviewSeed {
    return {
        version: 1,
        counts: importCounts({ create: 1 }),
        verdicts: [
            {
                $type: 'blog_post',
                $id: 'src-9',
                label,
                action: 'create',
                reason: 'new'
            }
        ],
        hasChanges: true
    };
}

test.describe('Content import dialog', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntryWrites(page);
    });

    test('a different file retires the verdicts of the last one [transfer:I-40]', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The two files answer with different verdicts, so "the table went
        // away" is not the whole assertion: the table that comes back has to
        // describe the file that is now selected. A dialog that kept the first
        // table would show one file's verdicts above another file's Import
        // button, which is the worst bug this screen can have.
        const spy = await mockTransferImport(page, {
            preview: (request) =>
                request.filename === 'second.json'
                    ? runNaming('A different story')
                    : runNaming('Imported story')
        });
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();

        await transferPage.openImportDialog();
        await transferPage.checkFile('first.json');
        await expect(transferPage.verdictRow('Imported story')).toBeVisible();

        // Choosing another file, with no other interaction, retires the table.
        await transferPage.chooseFile('second.json');
        await expect(transferPage.verdictTable).toHaveCount(0);
        await expect(transferPage.importSummary).toHaveCount(0);
        // …and the dialog is back in its first phase: nothing to confirm yet.
        await expect(transferPage.importButton).toHaveCount(0);
        await expect(transferPage.checkButton).toBeVisible();

        await transferPage.checkButton.click();
        await expect(
            transferPage.verdictRow('A different story')
        ).toBeVisible();
        await expect(transferPage.verdictRow('Imported story')).toHaveCount(0);
        expect(spy.previews.map((request) => request.filename)).toEqual([
            'first.json',
            'second.json'
        ]);
    });

    test('changing what happens to a matching record retires the verdicts [transfer:I-40]', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        const spy = await mockTransferImport(page);
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();

        await transferPage.openImportDialog();
        await transferPage.checkFile('story.json');
        await expect(transferPage.verdictRow('Imported story')).toBeVisible();
        expect(spy.previews).toHaveLength(1);
        expect(spy.previews[0].policy).toBe('skip');

        // The verdicts were computed under "leave it alone"; under "update it"
        // they would be different rows, so the table must go rather than sit
        // above an Import button that no longer means what it says.
        await transferPage.policyOption(/^Update it with the file/).click();
        await expect(
            transferPage.policyOption(/^Update it with the file/)
        ).toBeChecked();
        await expect(transferPage.verdictTable).toHaveCount(0);
        await expect(transferPage.importButton).toHaveCount(0);

        // Re-checking is a genuinely new run, under the setting now selected.
        await transferPage.checkButton.click();
        await expect(transferPage.verdictTable).toBeVisible();
        expect(spy.previews).toHaveLength(2);
        expect(spy.previews[1]).toMatchObject({
            policy: 'update',
            relations: 'link'
        });
    });

    test('changing what happens to the records the file links to retires them too [transfer:I-40]', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The dialog asks **two** questions, and the verdicts depend on both —
        // an export carries an article's author, and "add them again as new
        // records" changes what the run does without touching the first answer.
        const spy = await mockTransferImport(page);
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();

        await transferPage.openImportDialog();
        await transferPage.checkFile('story.json');
        await expect(transferPage.verdictTable).toBeVisible();

        await transferPage
            .policyOption(/^Add them again as new records/)
            .click();
        await expect(transferPage.verdictTable).toHaveCount(0);
        await expect(transferPage.importButton).toHaveCount(0);

        await transferPage.checkButton.click();
        await expect(transferPage.verdictTable).toBeVisible();
        expect(spy.previews[1]).toMatchObject({
            policy: 'skip',
            relations: 'recreate'
        });
    });

    test('an import re-reads the collection it wrote into [transfer:I-41]', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The row set the entries mock serves is mutable, and the apply pushes
        // into it — so the imported record exists on the server the moment the
        // apply answers, and the only way it reaches the screen is the refresh
        // pass. This is the shape of the defect the pass was written for: the
        // invalidation used to name `['content']`, which matches none of the
        // library's roots, so the import succeeded, the toast said so, and the
        // table never moved.
        const rows = [row('post-1', 'Hello world')];
        await mockTransferImport(page, {
            apply: () => {
                rows.push(row('post-2', 'Imported story'));
                return {
                    counts: IMPORT_RUN.counts,
                    verdicts: IMPORT_RUN.verdicts
                };
            }
        });
        await mockContentEntries(page, { entries: { blog_post: rows } });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();
        await expect(
            contentLibraryPage.recordLink('Imported story')
        ).toHaveCount(0);

        await transferPage.openImportDialog();
        await transferPage.checkFile('story.json');
        await transferPage.importButton.click();

        // The dialog closes on success…
        await expect(transferPage.importDialog).toHaveCount(0);
        await expect(
            contentLibraryPage.toast(/Imported 1 new record/)
        ).toBeVisible();
        // …and the list behind it is showing the record that just arrived,
        // without a reload and without the reader touching anything.
        await expect(
            contentLibraryPage.recordLink('Imported story')
        ).toBeVisible();
    });

    test('a file that would change nothing offers no Import', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // A run of pure skips is not an error — but offering "Import" for it is
        // a lie, so the button is dead and the banner says why.
        await mockTransferImport(page, {
            preview: () => IMPORT_NOTHING_TO_DO
        });
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();

        await transferPage.openImportDialog();
        await transferPage.checkFile('already-here.json');

        await expect(transferPage.nothingToDoBanner).toBeVisible();
        await expect(transferPage.verdictRow('Hello world')).toBeVisible();
        await expect(transferPage.importButton).toBeDisabled();
    });

    test('a refused import says what the server said, and keeps the file', async ({
        page,
        transferPage,
        contentLibraryPage
    }) => {
        // The refusals that matter here are the ones a person has to act on —
        // a file from a newer version, a permission they don't hold. The dialog
        // shows the server's own sentence rather than "that didn't work", and
        // stays open on the same file so the reader can change a setting and
        // try again.
        await mockTransferImport(page, {
            applyStatus: 400,
            applyMessage:
                'This file was written by a newer version of Ortha (2).'
        });
        await mockContentEntries(page, {
            entries: { blog_post: [row('post-1', 'Hello world')] }
        });

        await page.goto(RECORDS_URL);
        await expect(
            contentLibraryPage.recordsTable('Blog posts')
        ).toBeVisible();

        await transferPage.openImportDialog();
        await transferPage.checkFile('from-the-future.json');
        await transferPage.importButton.click();

        await expect(transferPage.importError).toHaveText(
            /written by a newer version of Ortha/
        );
        await expect(transferPage.importDialog).toBeVisible();
        await expect(transferPage.importButton).toBeVisible();
    });
});
