import { expect, test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    mockContentEntries,
    mockContentSchema,
    mockContentSchemaDetail
} from '../support/api/content';
import { mockCopilotApi } from '../support/api/copilot';
import { expectNoA11yViolations } from '../support/a11y';
import type { BrowserGlobals, EvalScrollable } from '../support/browserGlobals';

const WORKSPACE_ID = 'ws_marketing';

/**
 * The **docked panel** — the surface the Agents view is the other half of.
 *
 * What the page's suites already cover is the chat itself: transcript, composer,
 * steps, cards, model choice. Those components are literally shared, so this
 * suite deliberately does **not** re-assert them. What only exists here is the
 * window — several at once, tiled, collapsible to a pill, movable — and every
 * case below is about that chrome, or about the one rule the whole design rests
 * on: **closing a chat is what ends its run, and nothing else is.**
 */
test.describe('Ortha AI dock', () => {
    test.beforeEach(async ({ page, contentLibraryPage }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockCopilotApi(page);
        // Any page inside a workspace: the dock is contributed to the sidebar's
        // footer slot, and renders nothing outside one.
        await contentLibraryPage.goto(WORKSPACE_ID);
    });

    test('is the entry point, and opens a window focused on the composer [shell:I-13]', async ({
        copilotDockPage
    }) => {
        // With nothing open the dock *is* the button, carrying the shortcut
        // hint — which is where that shortcut is discoverable at all. The
        // glyph is platform-derived; which one is right for *this* browser is
        // asserted on its own below.
        await expect(copilotDockPage.dock).toContainText('Ortha AI');
        await expect(copilotDockPage.dock).toContainText(/(⌘|Ctrl)J/);

        await copilotDockPage.startChat();

        await expect(copilotDockPage.panel()).toBeVisible();
        // The panel is opened to type into, so the cursor goes where it is
        // needed — it is non-modal, so nothing else would put it there.
        await expect(copilotDockPage.composer()).toBeFocused();
    });

    test('⌘J starts a chat too', async ({ page, copilotDockPage }) => {
        // Wait for the dock before pressing: the shortcut is registered only
        // while the launcher is *available* (permissions resolved, a workspace
        // open), so a key sent during the first render lands on nothing.
        await expect(copilotDockPage.dock).toBeVisible();

        await page.keyboard.press('Meta+j');

        await expect(copilotDockPage.panel()).toBeVisible();
    });

    test('renders nothing outside a workspace', async ({
        workspacesPage,
        copilotDockPage
    }) => {
        await workspacesPage.goto();

        // A run is workspace-scoped (`X-Workspace-Id` is required), so offering
        // a chat with no workspace open could only ever produce a 400.
        await expect(copilotDockPage.dock).toBeHidden();
    });

    test('tiles three windows, and a fourth collapses the oldest', async ({
        copilotDockPage
    }) => {
        for (let i = 0; i < 3; i += 1) {
            await copilotDockPage.startChat();
        }
        await expect(copilotDockPage.windows()).toHaveCount(3);

        // Side by side, not stacked: the panel is non-modal so you can act on
        // an answer, and three windows covering each other would undo that.
        const first = await copilotDockPage.box(0);
        const second = await copilotDockPage.box(1);
        expect(second.x).not.toBe(first.x);

        await copilotDockPage.startChat();

        // The cap **minimizes rather than refuses**: the user asked for another
        // chat, and the one they stopped looking at is the cheapest to give up.
        // It keeps running as a pill.
        await expect(copilotDockPage.windows()).toHaveCount(3);
        await expect(copilotDockPage.pill('Untitled chat')).toHaveCount(4);
    });

    test('a pill toggles its window, and says which state it is in', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        const pill = copilotDockPage.pill('Untitled chat');
        await expect(pill).toHaveAttribute('aria-pressed', 'true');

        await pill.click();

        await expect(copilotDockPage.windows()).toHaveCount(0);
        await expect(pill).toHaveAttribute('aria-pressed', 'false');

        await pill.click();

        await expect(copilotDockPage.panel()).toBeVisible();
    });

    test('Escape collapses to the dock; it does not close', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();

        await copilotDockPage.composer().press('Escape');

        // Discarding a chat — and cancelling its run — is too much to hang off
        // the key people press to dismiss things. The pill stays.
        await expect(copilotDockPage.windows()).toHaveCount(0);
        await expect(copilotDockPage.pill('Untitled chat')).toBeVisible();
    });

    test('closing discards the chat and hands focus to the dock', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();

        await copilotDockPage.headerButton('Close').click();

        await expect(copilotDockPage.windows()).toHaveCount(0);
        await expect(copilotDockPage.pill('Untitled chat')).toHaveCount(0);
        // Otherwise focus falls to `<body>`, which strands a keyboard user at
        // the top of the page they were working on.
        await expect(copilotDockPage.newChat()).toBeFocused();
    });

    test('an untitled pill is “Untitled chat”, never “New chat”', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();

        // Two controls in one toolbar answering to the same name is ambiguous
        // by voice and in a screen reader's control list — and "New chat" is
        // the button sitting right beside it.
        await expect(copilotDockPage.pill('Untitled chat')).toBeVisible();
        await expect(copilotDockPage.newChat()).toBeVisible();
    });

    test('names a pill after what was asked in it', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();

        await copilotDockPage.ask('Set the summary please');

        await expect(
            copilotDockPage.pill(/^Set the summary please/)
        ).toBeVisible();
    });

    test('a run that finishes off screen marks its pill and the tab', async ({
        page,
        copilotDockPage
    }) => {
        // Held open, so the chat is collapsed *while the run is still going*.
        // The marker is edge-triggered off the run ending and dropped for a
        // chat that is visible at that moment — an instant answer would finish
        // before the window was minimized and correctly mark nothing.
        await mockCopilotApi(page, { runDelayMs: 1_500 });
        await copilotDockPage.startChat();
        await copilotDockPage.ask('Set the summary please');
        await copilotDockPage.composer().press('Escape');

        // `unread` is edge-triggered off the run ending and only ever set on a
        // chat that is off screen — badging one the user is already reading
        // trains them to ignore the badge.
        await expect(copilotDockPage.pill(/— finished/)).toBeVisible();
        await expect.poll(() => page.title()).toMatch(/^\(1\)/);

        await copilotDockPage.pill(/— finished/).click();

        await expect(copilotDockPage.pill(/— finished/)).toHaveCount(0);
        await expect.poll(() => page.title()).not.toMatch(/^\(1\)/);
    });

    test('opens a saved thread from the history dropdown', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();

        await copilotDockPage.openFromHistory(
            'Which articles are missing a summary?'
        );

        await expect(copilotDockPage.transcript()).toBeVisible();
        await expect(
            copilotDockPage.transcript().getByText('Three have none')
        ).toBeVisible();
    });

    test('Expand and Shrink are the same control, relabelled', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        const docked = await copilotDockPage.box();

        await copilotDockPage.headerButton('Expand').click();

        const expanded = await copilotDockPage.box();
        expect(expanded.width).toBeGreaterThan(docked.width);
        // The label reads off the *preset*, so the one control says which way
        // it will go rather than which state you are in.
        await expect(copilotDockPage.headerButton('Shrink')).toBeVisible();

        await copilotDockPage.headerButton('Shrink').click();

        expect((await copilotDockPage.box()).width).toBeLessThan(
            expanded.width
        );
        await expect(copilotDockPage.headerButton('Expand')).toBeVisible();
    });

    test('a moved window stays where it was put, and survives reopening', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        const before = await copilotDockPage.box();

        await copilotDockPage.dragBy(-200, -80);

        const after = await copilotDockPage.box();
        expect(after.x).toBeLessThan(before.x);
        expect(after.y).toBeLessThan(before.y);
        // A placement is remembered per **slot**, not per chat: a chat is
        // ephemeral, "the leftmost window" is a place the user arranged.
        await expect.poll(() => copilotDockPage.storedFrame(0)).not.toBeNull();

        await copilotDockPage.headerButton('Close').click();
        await copilotDockPage.startChat();

        // Within a pixel or two: the frame is re-clamped to the viewport on
        // read, so this asserts "it came back where it was left", not an exact
        // float round-trip.
        expect(
            Math.abs((await copilotDockPage.box()).x - after.x)
        ).toBeLessThan(12);
    });

    test('Expand is the way out of a bad drag', async ({ copilotDockPage }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.dragBy(-260, -120);
        await expect.poll(() => copilotDockPage.storedFrame(0)).not.toBeNull();

        await copilotDockPage.headerButton('Expand').click();

        // A window dragged mostly off a short screen is awkward to retrieve
        // with the same gesture that put it there, so the preset clears the
        // placement — and nothing else does, which is what lets it survive a
        // reload.
        await expect.poll(() => copilotDockPage.storedFrame(0)).toBeNull();
    });

    test('the arrow keys move a focused window', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        const before = await copilotDockPage.box();

        await copilotDockPage.moveHandle().focus();
        await copilotDockPage.moveHandle().press('ArrowLeft');

        // A window a mouse can move and a keyboard cannot is a window whose
        // position is a mouse-only setting.
        await expect
            .poll(async () => (await copilotDockPage.box()).x)
            .toBeLessThan(before.x);
    });

    test('the model choice survives collapsing and reopening', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.chooseModel('gpt-5.2');
        await expect(copilotDockPage.modelPicker()).toContainText('gpt-5.2');

        await copilotDockPage.composer().press('Escape');
        await copilotDockPage.pill('Untitled chat').click();

        // It lived in the component that drew the picker, so collapsing a
        // window silently put the user back on the default.
        await expect(copilotDockPage.modelPicker()).toContainText('gpt-5.2');
    });
});

/**
 * The page a chat has **attached** — the other half of what a window has to
 * remember, and the half that was losing it more easily.
 *
 * It lived in `useState` inside the panel's body, which unmounts the moment the
 * window collapses to the dock. So the ordinary sequence — attach the entry,
 * collapse the window to go and read it, come back and ask the question — sent
 * the turn with no context at all, and the chip had gone with it, so nothing on
 * screen said so.
 *
 * These cases need a URL the context is derived *from*, which is why the suite
 * below opens a collection's records table rather than the library's front page:
 * `readRouteContext` has nothing to offer where there is no content type.
 */
test.describe('Ortha AI dock — the attached page', () => {
    /** A collection whose records table gives the URL a content type. */
    const TYPE = 'blog_post';

    test.beforeEach(async ({ page, contentLibraryPage }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockCopilotApi(page);
        await contentLibraryPage.gotoSingle(WORKSPACE_ID, TYPE);
    });

    test('survives collapsing the window and reopening it', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.addContext().click();
        await expect(copilotDockPage.contextChip(`${TYPE} list`)).toBeVisible();

        await copilotDockPage.composer().press('Escape');
        await copilotDockPage.pill('Untitled chat').click();

        // The gesture people use to go and *look* at the page they attached is
        // the one that used to drop the attachment.
        await expect(copilotDockPage.contextChip(`${TYPE} list`)).toBeVisible();
    });

    test('is still what the next turn carries after a collapse', async ({
        page,
        copilotDockPage,
        contentLibraryPage
    }) => {
        const spy = await mockCopilotApi(page);
        await contentLibraryPage.gotoSingle(WORKSPACE_ID, TYPE);

        await copilotDockPage.startChat();
        await copilotDockPage.addContext().click();
        await copilotDockPage.composer().press('Escape');
        await copilotDockPage.pill('Untitled chat').click();

        await copilotDockPage.ask('Which of these is missing a summary?');

        // The chip being back is not the assertion that matters — what the run
        // body says is. A chip that redrew from a context the composer no longer
        // sends would be the same bug wearing the fix.
        await expect.poll(() => spy.runs.length).toBe(1);
        expect(spy.runs[0]).toMatchObject({
            context: { surface: 'records', contentType: TYPE }
        });
    });

    test('survives switching the window to another thread', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.addContext().click();

        await copilotDockPage.openFromHistory(
            'Which articles are missing a summary?'
        );

        // The attachment belongs to the question being written, not to the
        // transcript above it — so loading a thread into this window leaves it
        // alone, exactly as it leaves the model choice alone.
        await expect(copilotDockPage.contextChip(`${TYPE} list`)).toBeVisible();
    });

    test('can still be taken off after the window has been collapsed', async ({
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.addContext().click();
        await copilotDockPage.composer().press('Escape');
        await copilotDockPage.pill('Untitled chat').click();

        await copilotDockPage.removeContext().click();

        // The chip that came back is the live one, not a redraw of something
        // the composer had already lost track of.
        await expect(copilotDockPage.contextChip(`${TYPE} list`)).toHaveCount(
            0
        );
        await expect(copilotDockPage.addContext()).toBeVisible();
    });
});

/**
 * Accessibility scans of the window and its states. The panel is **non-modal on
 * purpose** — `aria-modal` is deliberately absent, because the rest of the page
 * is not inert and saying otherwise would be a lie to a screen reader.
 */
/**
 * The four defects a QA pass found in the dock and its windows, each pinned by
 * the smallest case that fails without the fix. Three are about **who a control
 * announces itself as**, and one is about a chat existing twice.
 */
test.describe('Ortha AI dock — regressions', () => {
    test.beforeEach(async ({ page, contentLibraryPage }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockCopilotApi(page);
        await contentLibraryPage.goto(WORKSPACE_ID);
    });

    test('the history dropdown will not open a thread a second window already holds', async ({
        copilotDockPage
    }) => {
        const THREAD = 'Which articles are missing a summary?';

        await copilotDockPage.startChat();
        await copilotDockPage.openFromHistory(THREAD);
        await expect(copilotDockPage.panelTitle(0)).toHaveText(THREAD);

        // A second window, and the same thread picked from *its* history. The
        // Agents rail's path goes through the sessions reducer, which refuses
        // this; the dropdown loaded straight into the chat and bypassed it.
        await copilotDockPage.startChat();
        await expect(copilotDockPage.windows()).toHaveCount(2);
        await copilotDockPage.openFromHistory(THREAD, 1);

        // Still exactly one window on that conversation, and it is the one that
        // already had it — the second is left on its own empty chat rather than
        // becoming a second, immediately-diverging view of one server-side
        // transcript.
        await expect(copilotDockPage.panelTitle(0)).toHaveText(THREAD);
        await expect(copilotDockPage.panelTitle(1)).toHaveText('Ortha AI');
        await expect(copilotDockPage.pill(THREAD)).toHaveCount(1);
    });

    test('collapsing a window hands focus back to the dock, by button and by Escape', async ({
        page,
        copilotDockPage
    }) => {
        await copilotDockPage.startChat();
        await expect(copilotDockPage.composer()).toBeFocused();

        // Escape collapses to the dock. The panel has always had a
        // return-focus mechanism; it was never handed the ref, so focus fell to
        // `<body>` and the next Tab restarted from the top of the document.
        await page.keyboard.press('Escape');
        await expect(copilotDockPage.windows()).toHaveCount(0);
        await expect(copilotDockPage.newChat()).toBeFocused();

        // The Minimize button is the same path and was equally broken — worse,
        // because the button that had focus unmounts under the pointer.
        await copilotDockPage.pills().first().click();
        await expect(copilotDockPage.composer()).toBeVisible();
        await copilotDockPage.headerButton('Minimize').click();
        await expect(copilotDockPage.windows()).toHaveCount(0);
        await expect(copilotDockPage.newChat()).toBeFocused();
    });

    test('the start button announces the label it shows, and the shortcut its platform accepts', async ({
        page,
        copilotDockPage
    }) => {
        const start = copilotDockPage.newChat();

        // 2.5.3 Label in Name: the visible text is "Ortha AI" and the
        // accessible name was the constant "New chat", so the two had nothing
        // in common — "click Ortha AI" did not work by voice.
        await expect(start).toHaveText(/Ortha AI/);
        await expect(start).toHaveAccessibleName(/Ortha AI/);

        // Both accepted chords are advertised, so assistive tech announces the
        // one its user can press rather than whichever glyph is drawn.
        await expect(start).toHaveAttribute(
            'aria-keyshortcuts',
            'Meta+J Control+J'
        );

        // And the drawn glyph follows the platform. It was the literal `⌘J` on
        // every OS, telling every Windows and Linux reader to press a key they
        // do not have — on the one affordance whose whole job is to teach the
        // shortcut.
        const isApple = await page.evaluate(() => {
            const { navigator } = globalThis as unknown as BrowserGlobals;
            return /mac|iphone|ipad|ipod/i.test(
                navigator.userAgentData?.platform ?? navigator.platform ?? ''
            );
        });
        await expect(start).toContainText(isApple ? '⌘J' : 'CtrlJ');
    });

    test('the transcript stops yanking a reader who has scrolled up', async ({
        page,
        contentLibraryPage,
        copilotDockPage
    }) => {
        // A held-open run, so the reader has a window in which to scroll away
        // while the answer is still coming.
        await mockCopilotApi(page, { runDelayMs: 1_500 });
        await contentLibraryPage.goto(WORKSPACE_ID);

        await copilotDockPage.startChat();
        await copilotDockPage.openFromHistory(
            'Which articles are missing a summary?'
        );
        await expect(copilotDockPage.transcript()).toBeVisible();

        // Guard against a vacuous pass: a transcript that does not overflow
        // cannot be scrolled away from, so "it did not scroll" would be true
        // for the wrong reason. The docked panel is deliberately small, which
        // is why this case lives here rather than on the full-page view.
        const overflow = await copilotDockPage.transcript().evaluate((el) => {
            const box = el as unknown as EvalScrollable;
            return box.scrollHeight - box.clientHeight;
        });
        expect(overflow).toBeGreaterThan(100);

        await copilotDockPage.ask('Set the summary please');
        await expect(copilotDockPage.headerButton('Minimize')).toBeVisible();

        // Mid-run, the reader goes back to re-read the top of the thread. The
        // scroll effect fired on every `turns` change unconditionally — and a
        // run dispatches one per frame — so this used to be undone by the very
        // next frame to land, with no way to stay put but to stop the run.
        await copilotDockPage.transcript().evaluate((el) => {
            (el as unknown as EvalScrollable).scrollTop = 0;
        });

        // The answer really did arrive — the other way this could pass for the
        // wrong reason.
        await expect(
            copilotDockPage
                .transcript()
                .getByText('Afterwards: the change is saved.')
        ).toBeVisible({ timeout: 15_000 });

        // …and the reader is still where they put themselves.
        expect(
            await copilotDockPage
                .transcript()
                .evaluate((el) => (el as unknown as EvalScrollable).scrollTop)
        ).toBeLessThan(40);
    });

    test('the dock is a group, and two windows have two names', async ({
        copilotDockPage
    }) => {
        // `toolbar` is a composite widget in the APG — one tab stop, arrow keys
        // inside it. The dock implements neither, so the role told a
        // screen-reader user to press arrows that do nothing. The POM resolving
        // it as a `group` at all is half the assertion.
        await expect(copilotDockPage.dock).toBeVisible();

        await copilotDockPage.startChat();
        await copilotDockPage.openFromHistory(
            'Which articles are missing a summary?'
        );
        await copilotDockPage.startChat();
        await copilotDockPage.openFromHistory(
            'Rewrite the pricing page intro',
            1
        );

        // Both windows used to answer to the accessible name "Ortha AI", so a
        // screen-reader user enumerating dialogs heard one name for every open
        // chat — while the visible headings told them apart.
        await expect(copilotDockPage.panel(0)).toHaveAccessibleName(
            'Which articles are missing a summary?'
        );
        await expect(copilotDockPage.panel(1)).toHaveAccessibleName(
            'Rewrite the pricing page intro'
        );
    });
});

test.describe('Ortha AI dock accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page, contentLibraryPage }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockCopilotApi(page);
        await contentLibraryPage.goto(WORKSPACE_ID);
    });

    test('the dock, with nothing open', async ({
        copilotDockPage,
        makeAxe
    }) => {
        await expect(copilotDockPage.dock).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });

    test('an open window over the page it is about', async ({
        copilotDockPage,
        makeAxe
    }) => {
        await copilotDockPage.startChat();
        await expect(copilotDockPage.composer()).toBeFocused();
        await expectNoA11yViolations(makeAxe());
    });

    test('three tiled windows', async ({ copilotDockPage, makeAxe }) => {
        for (let i = 0; i < 3; i += 1) {
            await copilotDockPage.startChat();
        }
        await expect(copilotDockPage.windows()).toHaveCount(3);
        await expectNoA11yViolations(makeAxe());
    });

    test('a transcript with a change card in it', async ({
        copilotDockPage,
        makeAxe
    }) => {
        await copilotDockPage.startChat();
        await copilotDockPage.openFromHistory(
            'Which articles are missing a summary?'
        );
        await expect(copilotDockPage.transcript()).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });
});
