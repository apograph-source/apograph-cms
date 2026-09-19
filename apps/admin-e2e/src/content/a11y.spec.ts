import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryChangedByAnotherSession
} from '../support/api/content';
import {
    NEEDS_REVIEW_VIEW,
    SHARED_VIEW,
    mockSavedViews
} from '../support/api/savedViews';
import { I18N_WORKSPACE, mockI18n } from '../support/api/i18n';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * Accessibility scans (axe, WCAG 2.1 A/AA) of the Content Library and its
 * dynamic states — the sidebar + welcome pane, an expanded group with a selected
 * type, and the open search palette. A regression guard, not a conformance claim.
 */
test.describe('Content Library accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        // Settle the switcher's query for every scan below. Left unmocked the
        // request fails, the switcher never renders, and the scans would pass
        // by looking at markup that is not there.
        await mockSavedViews(page, []);
    });

    test('sidebar + welcome pane', async ({ contentLibraryPage, makeAxe }) => {
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.group('Collections').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('expanded group + selected type', async ({
        contentLibraryPage,
        makeAxe
    }) => {
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.expandGroup('Collections');
        await contentLibraryPage.typeLink('Blog posts').click();
        await contentLibraryPage.viewHeading('Blog posts').waitFor();
        // Scan the real records table (selection checkboxes), not a stub.
        await contentLibraryPage.recordsTable('Blog posts').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('column picker — open', async ({ contentLibraryPage, makeAxe }) => {
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.expandGroup('Collections');
        await contentLibraryPage.typeLink('Blog posts').click();
        await contentLibraryPage.recordsTable('Blog posts').waitFor();
        // The picker holds the column toggles + drag handles; scan that surface.
        await contentLibraryPage.columnsButton.click();
        await contentLibraryPage.columnOption('Title').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('search palette — open', async ({ contentLibraryPage, makeAxe }) => {
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.openSearch();
        await expectNoA11yViolations(makeAxe());
    });

    test('sidebar error state', async ({
        page,
        contentLibraryPage,
        makeAxe
    }) => {
        // The failed-catalogue state used to be "render nothing", so it had no
        // markup to scan; now that it is an alert with a retry, scan it.
        await mockContentSchema(page, { status: 500 });
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.sidebarError.waitFor({ timeout: 15_000 });
        await expectNoA11yViolations(makeAxe());
    });

    test('entry editor — publish gate showing a refusal', async ({
        page,
        contentLibraryPage,
        makeAxe
    }) => {
        // The gate's per-row state words and the invalid field's paired
        // description/error only exist once a submit has been refused.
        await page.goto(
            `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
        );
        await contentLibraryPage.editorSave.first().click();
        await page.getByText('Needs attention:').first().waitFor();
        // Let the refusal toast expire first: sonner's own surface fails
        // contrast (a design-system issue, not this page's), and it would mask
        // the persistent state this case exists to scan.
        await page
            .locator('[data-sonner-toast]')
            .waitFor({ state: 'detached', timeout: 15_000 });
        await expectNoA11yViolations(makeAxe());
    });

    test('entry editor — the record changed elsewhere', async ({
        page,
        contentLibraryPage,
        makeAxe
    }) => {
        // The refused-re-seed banner (`ORT-230`): a warning `Alert` under the
        // record title, carrying a button, over a form the author is still
        // typing into. Registered after the `beforeEach` mocks so these win the
        // match — `page.route` resolves last-registered first.
        await mockContentEntryWrites(page, {});
        await mockEntryChangedByAnotherSession(page, {
            typeName: 'blog_post',
            id: 'post-contended',
            before: { title: 'Winter release notes' },
            after: { title: 'Winter release notes (rewritten elsewhere)' }
        });
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            'post-contended'
        );
        await contentLibraryPage.fieldTextbox('Title').fill('My rewrite');
        await contentLibraryPage.entryChangedNotice.waitFor({
            state: 'detached'
        });

        const loadedAt = await page.evaluate(() => Date.now());
        await page.clock.setFixedTime(loadedAt + 5 * 60_000);
        await page.evaluate(() => {
            const browser = globalThis as unknown as {
                window: { dispatchEvent(event: unknown): void };
                Event: new (type: string) => unknown;
            };
            browser.window.dispatchEvent(new browser.Event('visibilitychange'));
        });
        await contentLibraryPage.entryChangedNotice.waitFor();

        // **Announced, not thrust upon you.** The banner's `role="alert"` is a
        // live region, which is the whole reason a reader hears about this at
        // all — but the author is mid-sentence, and pulling the caret out of
        // the field they are typing in would be a worse interruption than the
        // one it reports. So the focused element is still the Title box, and
        // its discard control is an ordinary button waiting in the tab order
        // (driven for real by `entry-refetch-overwrite.spec.ts`).
        await expect(contentLibraryPage.fieldTextbox('Title')).toBeFocused();
        await expect(contentLibraryPage.entryChangedDiscard).toBeEnabled();

        await expectNoA11yViolations(makeAxe());
    });

    test('saved-view switcher — menu open', async ({
        page,
        contentLibraryPage,
        savedViewsPage,
        makeAxe
    }) => {
        await mockSavedViews(page, [NEEDS_REVIEW_VIEW, SHARED_VIEW]);
        await contentLibraryPage.goto(LIBRARY_WORKSPACE.id);
        await contentLibraryPage.expandGroup('Collections');
        await contentLibraryPage.typeLink('Blog posts').click();
        await contentLibraryPage.recordsTable('Blog posts').waitFor();
        // The menu holds the two visibility sections, the tick column and the
        // per-view actions — none of which exist until it is open.
        await savedViewsPage.open();
        await savedViewsPage.menuItem('Needs review').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('saved-view switcher — modified state', async ({
        page,
        savedViewsPage,
        makeAxe
    }) => {
        await mockSavedViews(page, [NEEDS_REVIEW_VIEW]);
        // The amber trigger and the three inline actions only exist once the
        // live state has drifted, and that trigger's contrast is the reason to
        // scan it.
        await savedViewsPage.goto(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            `?view=${NEEDS_REVIEW_VIEW.id}&sort=title`
        );
        await savedViewsPage.reset().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('saved-view delete confirmation', async ({
        page,
        savedViewsPage,
        makeAxe
    }) => {
        await mockSavedViews(page, [NEEDS_REVIEW_VIEW]);
        await savedViewsPage.goto(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            `?view=${NEEDS_REVIEW_VIEW.id}`
        );
        // A modal over a records page: its own name, and the page behind it
        // going `aria-hidden` while it is up, are what this scan is for.
        await savedViewsPage.open();
        await savedViewsPage.deleteItem().click();
        await savedViewsPage.confirmDeleteDialog().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('save-view dialog — Shared disabled without the permission', async ({
        page,
        savedViewsPage,
        makeAxe
    }) => {
        await mockSignedIn(page, { permissions: ['content:read'] });
        await mockSavedViews(page, []);
        await savedViewsPage.goto(LIBRARY_WORKSPACE.id, 'blog_post');
        await savedViewsPage.saveAs();
        // A disabled radio whose only explanation is its description — exactly
        // the pairing axe checks and a reader depends on.
        await savedViewsPage.dialog().waitFor();
        await expectNoA11yViolations(makeAxe());
    });
});

/**
 * The entry editor's **locale menu** — the title-row chip and the menu it
 * opens. Its own describe because it needs the i18n fixture's workspace rather
 * than the library one, and because an open Radix menu is a state, not a page:
 * the trigger's name, the radio items' checked state and the contrast of the
 * rows inside the portal only exist while it is up.
 */
test.describe('Locale menu accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    test('entry editor — locale menu open', async ({
        page,
        contentLibraryPage,
        makeAxe
    }) => {
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
        await contentLibraryPage.editorSave.waitFor();
        await contentLibraryPage.openLocaleMenu();
        await expectNoA11yViolations(makeAxe());
    });
});
