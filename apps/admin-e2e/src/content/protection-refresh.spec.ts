import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    ENTRY_CREATED_AT,
    LIBRARY_WORKSPACE,
    entryUpdatedAt,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryRelations
} from '../support/api/content';
import { UNPROTECTED, mockEntryReview } from '../support/api/protection';

const WS = LIBRARY_WORKSPACE.id;
const TYPE = 'blog_post';
/** The first row of the fabricated page — the record whose editor is opened. */
const ENTRY = 'blog_post-01';

/**
 * What the open editor shows about review **after a save**, without a reload.
 *
 * A save moves the head revision, so it changes which approvals count — and the
 * editor used to keep rendering the answer it had read before the save: the chip
 * still said `Reviewed · N of N`, the rail still counted the approval the save
 * had left behind, and the publish verdict was computed from the same stale read.
 * The fix is the entry's `updatedAt` as the **last** component of the review key,
 * so a save mints a new key and the panel reads afresh — with one exception, an
 * unprotected type, which must keep costing nothing (`protection:I-03` / `I-04`).
 *
 * Both halves need a real browser: the key is only exercised by the editor
 * actually re-rendering after a write, and the second one is an assertion about a
 * request that must **not** be made.
 *
 * Kept to those two facts on purpose. The fuller pass — the reviewer row, the
 * rail heading, both publish paths and the four review actions across a save —
 * extends this file rather than replacing it.
 */
test.describe('Review state after a save', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockContentEntryWrites(page);
        await mockEntryRelations(page);
    });

    /**
     * ⭐ The bug: the entry was approved, the save left that approval on the
     * previous version, and the chip went on claiming the entry was reviewed
     * until somebody reloaded the page.
     */
    test('rolls the chip back from reviewed to pending after a save', async ({
        page,
        contentLibraryPage
    }) => {
        const review = await mockEntryReview(page, {
            required: 1,
            given: 1,
            blocked: false,
            approvals: [{ userId: 'u_ada', revisionNumber: 7 }]
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);
        await expect(page.getByText('Reviewed · 1 of 1')).toBeVisible();

        // Where the server stands once the save has written a new version: the
        // one approval is off the head and no longer counts.
        review.serve({
            required: 1,
            given: 0,
            stale: 1,
            blocked: true,
            approvals: [{ userId: 'u_ada', revisionNumber: 7, isStale: true }]
        });

        await contentLibraryPage.fieldTextbox('Title').fill('A later draft');
        await contentLibraryPage.saveDraft();
        await expect(contentLibraryPage.savedToast).toBeVisible();

        // Read afresh under the new version's key, in the page that is already
        // open — no reload anywhere in this test.
        await expect(page.getByText('Needs review · 0 of 1')).toBeVisible();
        await expect(page.getByText('Reviewed · 1 of 1')).toHaveCount(0);
    });

    /**
     * The other side of the same key, and the one nothing on screen can show: a
     * type with no rule must not spend a request per save to be told again that
     * there is nothing to review. With no rule the editor is the editor it was
     * before this plugin existed (`protection:I-03` / `I-04`), and
     * `entryReviewVersion` holds the previous token to keep it that way.
     */
    test('asks nothing again after a save on an unprotected type [protection:I-03]', async ({
        page,
        contentLibraryPage
    }) => {
        const review = await mockEntryReview(page, UNPROTECTED);
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        // One read for the editor — the chip, the rail and the verdict share it.
        await expect.poll(() => review.reads).toBe(1);

        await contentLibraryPage.fieldTextbox('Title').fill('A later draft');
        await contentLibraryPage.saveDraft();
        await expect(contentLibraryPage.savedToast).toBeVisible();

        // The save really did write a new version — the fixture stamps
        // `updatedAt` the way the server does, so "nothing was re-read" is about
        // the key rather than about a write that moved nothing.
        expect(entryUpdatedAt(page, TYPE, ENTRY)).not.toBe(ENTRY_CREATED_AT);

        // A wall-clock settle, because the assertion is an **absence**: there is
        // no request to wait for when the correct behaviour is that none is made.
        // React Query fires an enabled query during the mount commit, so half a
        // second after the save's toast is long past the moment a new key would
        // have shown as a read.
        await page.waitForTimeout(500);
        expect(review.reads).toBe(1);
    });
});
