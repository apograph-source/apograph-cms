import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryRead,
    mockEntryRelations
} from '../support/api/content';
import { type ContentLibraryPage } from '../support/pages/ContentLibraryPage';

/**
 * The shell's **right panel** (`@orthacms/shell-admin`'s `AppRightPanel` +
 * `pageChrome`) — the third column a page fills with `RightPanelPortal`. The entry
 * editor's Properties panel is the only registration in the product, so it is the
 * fixture; what is under test is the chrome, not the editor.
 *
 * Nothing exercised this before, and the gap had a shape: every one of these
 * defects is invisible to a pointer and invisible to axe. The collapse/reopen pair
 * is deliberately split across two components — "Hide {title}" inside the panel,
 * "Show {title}" in the top bar — and only one of them is reachable at a time, so
 * **every toggle destroys the control that caused it**. Collapsing puts that button
 * inside the `inert` `<aside>`; reopening unmounts the bar's button. Both directions
 * left `document.activeElement` on `<body>`: the next Tab restarted at the top of
 * the document, and a screen reader heard nothing, because the (correct)
 * `aria-expanded` pair was on two buttons nobody was focused on.
 *
 * The narrow-viewport cases are worse, because they are also *stateful*: the phone
 * layout forces the panel collapsed whatever was stored, and that forced value was
 * being persisted — one visit on a phone overwrote a desktop preference for good.
 */

/** Under `pageChrome`'s `MOBILE_QUERY` (`max-width: 767px`) — the overlay layout. */
const NARROW = { width: 390, height: 780 };
/** A blog post to open the editor on; its content is beside the point here. */
const ENTRY_ID = 'blog_post-panel';

test.describe('the right panel', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockContentEntryRead(page, {
            records: { [`blog_post/${ENTRY_ID}`]: { title: 'Panel fixture' } }
        });
        // The editor loads relations on open; blog_post has none.
        await mockEntryRelations(page);
    });

    /** Opens the editor with the panel registered and shown. */
    async function openEditorWithPanel(contentLibraryPage: ContentLibraryPage) {
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );
        await contentLibraryPage.propertiesPanel.waitFor();
    }

    test('collapsing it from the keyboard hands focus to the reopen button [shell:I-18]', async ({
        contentLibraryPage
    }) => {
        await openEditorWithPanel(contentLibraryPage);

        await contentLibraryPage.hidePropertiesButton.focus();
        await expect(contentLibraryPage.hidePropertiesButton).toBeFocused();
        await contentLibraryPage.hidePropertiesButton.press('Enter');

        // The regression: the button that was just activated is now inside an
        // `inert` subtree, so the browser blurs it to `<body>`. Asserting on the
        // survivor rather than "not body" because *which* control gets focus is
        // the whole point — it is the only way back to the panel, and a keyboard
        // user who lands anywhere else has to traverse the entire chrome to find
        // it (WCAG 2.4.3).
        await expect(contentLibraryPage.showPropertiesButton).toBeFocused();
    });

    test('reopening it from the keyboard hands focus back into the panel [shell:I-18]', async ({
        contentLibraryPage
    }) => {
        await openEditorWithPanel(contentLibraryPage);

        await contentLibraryPage.hidePropertiesButton.focus();
        await contentLibraryPage.hidePropertiesButton.press('Enter');
        await expect(contentLibraryPage.showPropertiesButton).toBeFocused();

        // The other direction was broken too, and for the opposite reason: the
        // reopen button is not inert, it simply stops existing once the panel is
        // back (`showExpand` is `present && !open`). A handoff that only covered
        // collapsing would have looked complete and still dropped focus here.
        await contentLibraryPage.showPropertiesButton.press('Enter');

        await expect(contentLibraryPage.hidePropertiesButton).toBeFocused();
    });

    test('a collapse the user never asked for is not persisted as a preference [shell:I-21]', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditorWithPanel(contentLibraryPage);
        // The panel is open on a wide screen, so this is what is stored.
        expect(await contentLibraryPage.storedRightPanelState()).toBe('open');

        await page.setViewportSize(NARROW);
        await page.reload();
        await contentLibraryPage.showPropertiesButton.waitFor();

        // The phone layout is right to start collapsed — a 22rem overlay covering
        // the page on arrival is nobody's request. What it must not do is write
        // that back: the persist effect ran with the forced value and destroyed the
        // desktop preference, so one visit on a phone left the panel collapsed on
        // every later wide-screen load, with nothing to explain it. Both the code's
        // own comment and the shell's AGENTS.md claimed this could not happen.
        expect(await contentLibraryPage.storedRightPanelState()).toBe('open');
    });

    test('the desktop preference survives a narrow visit', async ({
        page,
        contentLibraryPage
    }) => {
        await openEditorWithPanel(contentLibraryPage);
        await page.setViewportSize(NARROW);
        await page.reload();
        await contentLibraryPage.showPropertiesButton.waitFor();

        await page.setViewportSize({ width: 1280, height: 800 });
        await page.reload();

        // The observable half of the test above: back on a wide screen the column
        // is there again, because nothing overwrote the stored `open`.
        await expect(contentLibraryPage.propertiesPanel).toBeVisible();
    });
});

test.describe('the right panel as a narrow-viewport overlay', () => {
    test.use({ viewport: NARROW });

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockContentEntryRead(page, {
            records: { [`blog_post/${ENTRY_ID}`]: { title: 'Panel fixture' } }
        });
        await mockEntryRelations(page);
    });

    /** Opens the editor and raises the overlay (it starts collapsed here). */
    async function raiseOverlay(contentLibraryPage: ContentLibraryPage) {
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );
        await contentLibraryPage.showPropertiesButton.waitFor();
        await contentLibraryPage.showPropertiesButton.click();
        await contentLibraryPage.propertiesPanel.waitFor();
    }

    test('Escape dismisses it [shell:I-22]', async ({
        page,
        contentLibraryPage
    }) => {
        await raiseOverlay(contentLibraryPage);
        await expect(contentLibraryPage.propertiesPanel).toBeVisible();

        await page.keyboard.press('Escape');

        // It is not a Radix `Sheet` and cannot become one — a Sheet unmounts its
        // content, and the panel's body is a portal host that has to stay mounted
        // or collapsing throws away the filler's state and refetches its data. So
        // `Esc`, the one thing a Sheet would have brought for free, is hand-wired,
        // and this is what pins it. Before: nothing happened at all, and the only
        // way out was tabbing back to a collapse button that the scrim was covering.
        await expect(contentLibraryPage.showPropertiesButton).toBeVisible();
    });

    test('dismissing it with Escape still lands focus somewhere usable', async ({
        page,
        contentLibraryPage
    }) => {
        await raiseOverlay(contentLibraryPage);

        await page.keyboard.press('Escape');

        // Closing by keyboard has the same focus problem as the collapse button,
        // and the same answer: the reopen control takes it.
        await expect(contentLibraryPage.showPropertiesButton).toBeFocused();
    });

    test('the scrim is decoration, not an unreachable control [shell:I-23]', async ({
        contentLibraryPage
    }) => {
        await raiseOverlay(contentLibraryPage);

        // It was a `<button type="button" tabIndex={-1} aria-hidden>`: a control
        // with a real behaviour (dismiss), deliberately removed from the tab order
        // and hidden from assistive technology, with no keyboard equivalent — a
        // 4.1.2/1.3.1 smell and a dismiss affordance only a pointer could use. Now
        // that `Esc` exists, the honest shape is inert decoration. Asserted as "no
        // hidden button claims this job" rather than on the div, so replacing the
        // scrim's markup cannot quietly reintroduce the pattern.
        await expect(contentLibraryPage.propertiesScrim).toBeVisible();
        await expect(contentLibraryPage.propertiesScrim).not.toHaveJSProperty(
            'tagName',
            'BUTTON'
        );
    });
});
