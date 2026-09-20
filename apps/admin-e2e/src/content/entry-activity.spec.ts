import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryRelations
} from '../support/api/content';
import { mockEntryActivity } from '../support/api/activity';

/** A seeded blog post to open the editor on (`entriesFor` numbers them). */
const ENTRY_ID = 'blog_post-01';

/**
 * ORT-198 — the entry editor's **Activity** tab.
 *
 * It was a section of the Properties rail, which is 240px wide, shared by
 * widgets from four plugins, and collapsible as one — so a record's history
 * showed six wrapped rows and disappeared entirely whenever the reader
 * collapsed the panel. As a tab it is a route: linkable, and surviving the
 * remounts this editor takes from navigations it does not own.
 *
 * The tab reads `GET /activity/entries/:id`, gated `content:read` rather than
 * the admin-only `activity:read` that guards the deployment-wide log.
 */
test.describe('Entry activity tab', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        // Registered before the relations mock: its multi-segment route also
        // matches `…/:id/relations`, and the last matching route wins.
        await mockContentEntryWrites(page);
        // The editor loads relations on open; blog_post has none, so serve
        // empty and keep the request off the dev proxy.
        await mockEntryRelations(page);
    });

    test('lists what happened to the record, actors and all', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryActivity(page);
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );

        await contentLibraryPage.openEditorTab('Activity');

        // Localized action labels, not the raw `entry.published` wire tokens.
        await expect(page.getByText('Published content')).toBeVisible();
        await expect(page.getByText('Edited content')).toBeVisible();
        await expect(page.getByText('ada@ortha.dev')).toBeVisible();
        // An event nobody performed reads as "System", not as a blank actor.
        await expect(page.getByText('System', { exact: true })).toBeVisible();
        await expect(page.getByText('3 recorded actions')).toBeVisible();
    });

    test('does not fetch a history for a record that has none yet', async ({
        page,
        contentLibraryPage
    }) => {
        let asked = false;
        await page.route('**/api/activity/entries/*', async (route) => {
            asked = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: [],
                    total: 0,
                    page: 1,
                    pageSize: 25
                })
            });
        });

        await page.goto(
            `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
        );
        await contentLibraryPage.openEditorTab('Activity');

        // The tab explains itself rather than showing an empty list — and asks
        // the API nothing, because an unsaved record has no id to ask about.
        await expect(page.getByText('has not been saved yet')).toBeVisible();
        expect(asked).toBe(false);
    });

    /**
     * "Nothing happened" and "we could not find out" read identically on
     * screen, and only one of them is a fact — so a failed load must not
     * render as the empty state.
     */
    test('says the history could not be loaded rather than showing it empty', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryActivity(page, [], { status: 500 });
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );

        await contentLibraryPage.openEditorTab('Activity');

        // Anchored on the tab's own wording: the alarms rail widget says
        // "Checks could not be loaded" on the same screen, and the bare phrase
        // matches both.
        //
        // A 5xx takes TanStack Query's full retry ladder before `isError`.
        await expect(
            page.getByText('The history could not be loaded')
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Nothing has been recorded')).toHaveCount(
            0
        );
    });
});
