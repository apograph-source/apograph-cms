import { type Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    CONTENT_DETAIL_SEED,
    CONTENT_SCHEMA_SEED,
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryChangedByAnotherSession
} from '../support/api/content';

/** The record this suite edits — deliberately not one of the list seed's rows. */
const ENTRY_ID = 'post-contended';
const STORED_TITLE = 'Winter release notes';
const SAVED_ELSEWHERE = 'Winter release notes (rewritten by someone else)';
const MINE = 'My unsaved rewrite';

/**
 * Return to the tab, on a clock that says the entry read has gone stale.
 *
 * Lifted from `auth/private-routes.spec.ts`, which explains the two choices:
 * `setFixedTime` (not `install`) moves the page past the query's `staleTime`
 * while leaving timers running, and the event is `visibilitychange` on `window`
 * because that is the only one TanStack Query's focus manager listens to since
 * v5 — dispatching `focus` instead would do nothing and the test would pass by
 * never having refetched at all.
 */
async function returnToTab(page: Page): Promise<void> {
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.setFixedTime(loadedAt + 5 * 60_000);
    await page.evaluate(() => {
        // Typed inline through `globalThis`: this project's tsconfig ships no
        // DOM lib, the same reason `reflow.spec.ts` casts for `documentElement`.
        const browser = globalThis as unknown as {
            window: { dispatchEvent(event: unknown): void };
            Event: new (type: string) => unknown;
        };
        browser.window.dispatchEvent(new browser.Event('visibilitychange'));
    });
}

/**
 * **A background refetch must not throw away what the author has typed.**
 *
 * `ContentEntryView` memoises the editor's initial values on the record it read
 * (`resolved`, keyed on `editEntry`), and `useEntryForm` re-seeds whenever that
 * object's **identity** changes. TanStack Query's structural sharing hides this
 * for as long as the answer keeps coming back deeply equal — which is why a
 * focus refetch of an *unchanged* record is harmless, and why this is invisible
 * in a suite where nothing ever changes underneath.
 *
 * It stops being harmless the moment the answer differs. The editor's entry read
 * has a `staleTime` of 30 s and `refetchOnWindowFocus` is on, so an author who
 * leaves a half-written record to check something and comes back gets a refetch;
 * if a colleague saved in the meantime, the refetched row is a new object, the
 * memo re-keys, and the form re-seeds **over the author's unsaved edits**. No
 * prompt, no conflict notice, no undo — the unsaved-changes guard never fires
 * because nothing navigated.
 *
 * This is the same mechanism as `ORT-228` (`i18n-translation-draft.spec.ts`),
 * reached through the other dependency of the same memo: there it was the
 * create prefill re-identified by the history API, here it is the record itself
 * genuinely changing. `useCreatePrefill` fixed the first; this one is untouched.
 *
 * **Pre-existing on `main`** — found driving the live stack during `ORT-227`
 * QA cycle 2, and reproduced by hand twice against a real server before this was
 * written. It is *not* a regression from that branch.
 *
 * Read a failure by which assertion fires:
 *
 *   - the stored title      → the mock never served the record; the rest means
 *                             nothing.
 *   - the typed title       → the fill was dropped, same.
 *   - the rail's Status     → the refetch never landed, so the final assertion
 *                             would be true of a tab nothing woke.
 *   - the last one          → the defect: the refetch overwrote the author.
 */
test.describe('Entry editor — a record that changed while the tab was away', () => {
    test('keeps the author’s unsaved edits when a background refetch brings different values [ORT-227]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page, { types: CONTENT_SCHEMA_SEED });
        await mockContentSchemaDetail(page, { details: CONTENT_DETAIL_SEED });
        await mockContentEntries(page, { details: CONTENT_DETAIL_SEED });
        await mockContentEntryWrites(page, { details: CONTENT_DETAIL_SEED });
        await mockEntryChangedByAnotherSession(page, {
            typeName: 'blog_post',
            id: ENTRY_ID,
            before: { title: STORED_TITLE },
            after: { title: SAVED_ELSEWHERE }
        });

        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );

        // The record loaded, and it loaded from *this* mock rather than the
        // fabricated row `mockContentEntryWrites` would otherwise answer with.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            STORED_TITLE
        );

        await contentLibraryPage.fieldTextbox('Title').fill(MINE);
        // The precondition, asserted rather than assumed: everything below is
        // about protecting typed input, and an empty form has none to lose.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            MINE
        );

        await expect(contentLibraryPage.entryDetailsStatus).toHaveText('Draft');

        await returnToTab(page);

        // **The precondition that decides whether the assertion below means
        // anything, and it is not `reads()`.** Counting the request only proves
        // it was *issued*; the response lands a tick later, and
        // `toHaveValue(MINE)` is satisfied by its first poll — so a test that
        // waited on the counter would pass on a build that overwrites the form
        // half a frame afterwards. That is exactly how this spec first went
        // green against a defect it had already reproduced.
        //
        // The rail's Status is read off the refetched **record**, not off the
        // editor's state, so it flips when the new row reaches the screen and
        // keeps doing so however the form is fixed. Waiting for it is waiting
        // for the refetch to have been *applied*.
        await expect(contentLibraryPage.entryDetailsStatus).toHaveText(
            'Published'
        );

        // Nothing navigated and nothing was saved, so the record on screen is
        // still the author's draft. The refetched row is news about the server,
        // not an instruction to discard a person's work.
        await expect(contentLibraryPage.fieldTextbox('Title')).toHaveValue(
            MINE
        );
    });
});
