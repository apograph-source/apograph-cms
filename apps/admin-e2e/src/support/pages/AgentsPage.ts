import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the **Agents view** (`@orthacms/copilot-admin`) — the
 * full-page chat at `/workspaces/:id/agents`, its thread rail, the composer, and
 * the sidebar's CMS ⇄ Agents switcher. Seed it with `mockSignedIn`,
 * `mockWorkspaces` and `mockCopilotApi`.
 *
 * Two scoping rules are load-bearing and are why almost everything below hangs
 * off a region rather than off `page`:
 *
 * - **The docked panel renders the same composer, transcript and model picker.**
 *   The dock is portalled to `<body>`, and the page's own column is inside the
 *   shell's `<main>` — so the thread handles are scoped to `main` and can never
 *   accidentally drive a floating window that happens to be open.
 * - **"New chat" and "Chats" each name two controls.** The rail has a New chat
 *   button and the dock has one; the rail is an `aside` labelled "Chats" wrapping
 *   a `nav` with the same name. Scoping to {@link rail} / {@link dock} keeps each
 *   handle pointing at one thing.
 */
export class AgentsPage extends BasePage {
    /** The shell's inset — everything the *page* renders, and nothing portalled. */
    readonly main: Locator;
    /** The thread column (md+). Below that the same list lives in a sheet. */
    readonly rail: Locator;
    /** The bottom-right bar of chats the dock owns. */
    readonly dock: Locator;

    constructor(page: Page) {
        super(page);
        this.main = page.getByRole('main');
        this.rail = page.getByRole('complementary', { name: 'Chats' });
        // A `group` in the sidebar's footer, a `complementary` while it floats
        // with the sidebar collapsed — see `CopilotDockPage` for why each.
        const name = 'Ortha CMS AI chats';
        this.dock = page
            .getByRole('group', { name, exact: true })
            .or(page.getByRole('complementary', { name, exact: true }));
    }

    // --- navigation -------------------------------------------------------

    /** An unsaved new chat: `/workspaces/:id/agents`. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/agents`);
    }

    /** One saved thread: `/workspaces/:id/agents/:conversationId`. */
    async gotoThread(workspaceId: string, conversationId: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/agents/${conversationId}`
        );
    }

    // --- the sidebar's CMS ⇄ Agents switcher ------------------------------

    /** The two-segment control at the top of the workspace sidebar. */
    viewSwitcher(): Locator {
        return this.page.getByRole('radiogroup', { name: 'View' });
    }

    /** One half of the switcher. Radix renders each segment as a radio. */
    viewTab(name: 'CMS' | 'Agents'): Locator {
        return this.viewSwitcher().getByRole('radio', { name });
    }

    /** Switch modes. Going back to CMS returns to the page you left. */
    async switchView(name: 'CMS' | 'Agents') {
        await this.viewTab(name).click();
    }

    // --- the top bar ------------------------------------------------------

    /** The breadcrumb's leaf — the open thread's title, or "New chat". */
    breadcrumbLeaf(): Locator {
        return this.main
            .getByRole('navigation', { name: 'Breadcrumb' })
            .getByRole('listitem')
            .last();
    }

    // --- the rail ---------------------------------------------------------

    /** Starts an unsaved chat. Scoped to the rail — the dock has one too. */
    railNewChat(): Locator {
        return this.rail.getByRole('button', { name: 'New chat' });
    }

    /** The filter. Only rendered past five threads. */
    railFilter(): Locator {
        return this.rail.getByRole('searchbox', { name: 'Search chats' });
    }

    /** Type into the filter. */
    async filterChats(query: string) {
        await this.railFilter().fill(query);
    }

    /** One thread's row, by the title it shows. */
    railRow(title: string): Locator {
        return this.rail.getByRole('button', { name: title, exact: true });
    }

    /** Every thread row currently listed, in rail order. */
    railRows(): Locator {
        return this.rail.getByRole('listitem');
    }

    /** A recency heading ("Today", "Previous 7 days", …). */
    railGroup(name: string): Locator {
        return this.rail.getByRole('heading', { name });
    }

    /** Every recency heading on screen, in order — for grouping assertions. */
    async railGroupNames(): Promise<string[]> {
        // Level 3 only. The rail itself carries a visually-hidden `<h2>` naming
        // the column, so the page's `<h1>` no longer jumps straight to the date
        // buckets (`ORT-167`) — and a bare `getByRole('heading')` would count it
        // as a bucket.
        return this.rail.getByRole('heading', { level: 3 }).allInnerTexts();
    }

    /** The rail's "couldn't load your chats" state — distinct from empty. */
    railError(): Locator {
        return this.rail.getByRole('alert');
    }

    /** Its retry control. */
    railRetry(): Locator {
        return this.railError().getByRole('button', { name: 'Try again' });
    }

    /** The rail's empty / no-matches line, whichever is showing. */
    railMessage(text: string | RegExp): Locator {
        return this.rail.getByText(text);
    }

    /** The footer link into the archive. Absent while nothing is archived. */
    archivedLink(): Locator {
        return this.rail.getByRole('button', { name: /^Archived/ });
    }

    /** The way out of the archive (it replaces New chat while in it). */
    backToChats(): Locator {
        return this.rail.getByRole('button', { name: 'Back to chats' });
    }

    // --- a row's ⋯ menu ---------------------------------------------------

    /** A row's actions trigger. Named after the chat, not a bare "More". */
    rowMenuTrigger(title: string): Locator {
        return this.rail.getByRole('button', { name: `Actions for ${title}` });
    }

    /** Open a row's ⋯ menu. */
    async openRowMenu(title: string) {
        await this.rowMenuTrigger(title).click();
    }

    /** An item in the open row menu. */
    rowMenuItem(name: 'Rename…' | 'Archive' | 'Unarchive'): Locator {
        return this.page.getByRole('menuitem', { name });
    }

    /** Open a row's menu and pick one of its actions. */
    async chooseRowAction(
        title: string,
        action: 'Rename…' | 'Archive' | 'Unarchive'
    ) {
        await this.openRowMenu(title);
        await this.rowMenuItem(action).click();
    }

    // --- the rename dialog ------------------------------------------------

    /** The rename dialog. */
    renameDialog(): Locator {
        return this.page.getByRole('dialog', { name: 'Rename chat' });
    }

    /** Its one field. */
    renameInput(): Locator {
        return this.renameDialog().getByLabel('Chat name');
    }

    /** Its Save control — disabled only while saving, never on a bad value. */
    renameSave(): Locator {
        return this.renameDialog().getByRole('button', { name: 'Save' });
    }

    /** Its Cancel control. */
    renameCancel(): Locator {
        return this.renameDialog().getByRole('button', { name: 'Cancel' });
    }

    /** A validation or failure message inside the dialog. */
    renameError(text: string | RegExp): Locator {
        return this.renameDialog().getByText(text);
    }

    /** Rename a thread end to end. */
    async renameChat(title: string, next: string) {
        await this.chooseRowAction(title, 'Rename…');
        await this.renameInput().fill(next);
        await this.renameSave().click();
    }

    // --- the thread -------------------------------------------------------

    /** The transcript region. Absent until the thread has a turn in it. */
    transcript(): Locator {
        return this.main.getByRole('log', { name: 'Conversation' });
    }

    /**
     * The transcript's rendered text, top to bottom.
     *
     * The handle **ordering** assertions use: a turn is prose, tool steps and
     * change cards interleaved in the order the run produced them, and the bug
     * worth guarding is a card rendering below the sentence written after it.
     * Comparing `indexOf` of two fragments says that in one line, and needs no
     * selector for a layout wrapper that carries no semantics.
     */
    async transcriptText(): Promise<string> {
        return this.transcript().innerText();
    }

    /** The empty thread's greeting. */
    welcomeHeading(): Locator {
        return this.main.getByRole('heading', {
            name: /What can I help you with/
        });
    }

    /** One of the empty state's four openers. */
    suggestion(text: string | RegExp): Locator {
        return this.main.getByRole('button', { name: text });
    }

    /** The "could not open this chat" state. */
    threadError(): Locator {
        return this.main.getByRole('alert').filter({
            hasText: 'Could not open this chat'
        });
    }

    /** Its retry control. */
    threadRetry(): Locator {
        return this.threadError().getByRole('button', { name: 'Try again' });
    }

    /** One tool step's collapsed line, e.g. /Updated an entry/. */
    toolStep(label: string | RegExp): Locator {
        return this.main.getByRole('button', { name: label });
    }

    /** A change card, named by its own summary. */
    proposalCard(summary: string | RegExp): Locator {
        return this.main.getByRole('region', { name: summary });
    }

    /** The "this did not apply" banner inside a change card that failed. */
    proposalError(summary: string | RegExp): Locator {
        return this.proposalCard(summary).getByRole('alert');
    }

    /**
     * That banner's icon.
     *
     * A CSS selector rather than a role: the glyph is decorative and carries
     * `aria-hidden`, which is correct and also means there is no accessible
     * handle for it — and its **position** is exactly what the spec measures.
     */
    proposalErrorIcon(summary: string | RegExp): Locator {
        return this.proposalError(summary).locator('svg');
    }

    /**
     * The scrolling block inside that banner — the server's reason itself.
     *
     * A `group` rather than the banner: the reason is height-bounded and
     * scrolls, so it is its own focusable, named element, and the numbers the
     * specs read (`scrollHeight` vs `clientHeight`) are that element's, not the
     * alert's padding box.
     */
    proposalReason(summary: string | RegExp): Locator {
        return this.proposalError(summary).getByRole('group', {
            name: 'Why this change was not saved'
        });
    }

    /**
     * How the reason's box and its content compare, in one read.
     *
     * `scrollHeight > clientHeight` is the whole question both directions of
     * the bound turn on: overflow means the block scrolls rather than growing,
     * and equality means a short reason reserved no space and grew no
     * scrollbar.
     */
    async proposalReasonScroll(
        summary: string | RegExp
    ): Promise<{ client: number; scroll: number; top: number }> {
        return this.proposalReason(summary).evaluate((element) => {
            // Typed by hand, the same idiom as `fileTransfer` below: this
            // package's tsconfig has no DOM lib, so Playwright's
            // `SVGElement | HTMLElement` is as far as the compiler gets and
            // neither half of that union carries the scroll metrics.
            const box = element as unknown as {
                clientHeight: number;
                scrollHeight: number;
                scrollTop: number;
            };
            return {
                client: box.clientHeight,
                scroll: box.scrollHeight,
                top: box.scrollTop
            };
        });
    }

    /** A change card's diff — the `<dl>` of fields the change touched. */
    proposalDiff(summary: string | RegExp): Locator {
        return this.proposalCard(summary).locator('dl');
    }

    /** A change card's status badge ("Saved", "Not saved", "Discarded"). */
    proposalBadge(summary: string | RegExp, label: string): Locator {
        return this.proposalCard(summary).getByText(label, { exact: true });
    }

    /** A change card's closing line ("Nothing was saved."), for the spacing. */
    proposalFooter(summary: string | RegExp): Locator {
        return this.proposalCard(summary).locator('footer');
    }

    /**
     * The pulsing line under a streaming turn — what the run says it is doing.
     *
     * `role="log"`-scoped rather than page-wide: the composer has a status line
     * of its own a few pixels below it.
     */
    activityLine(text: string | RegExp): Locator {
        return this.transcript().getByText(text);
    }

    // --- the composer -----------------------------------------------------

    /** The message box. */
    composer(): Locator {
        return this.main.getByRole('textbox', {
            name: 'Ask about your content…'
        });
    }

    /** Send — becomes Stop while a run is in flight. */
    sendButton(): Locator {
        return this.main.getByRole('button', { name: 'Send' });
    }

    /** Stop, i.e. the same button mid-run. */
    stopButton(): Locator {
        return this.main.getByRole('button', { name: 'Stop' });
    }

    /** Type a turn and send it with Enter, the way a user does. */
    async ask(text: string) {
        await this.composer().fill(text);
        await this.composer().press('Enter');
    }

    /**
     * The transcript's centred text column — the `max-w-3xl` child of the
     * scroller, not the scroller itself.
     *
     * The scroller deliberately runs the full width so the scrollbar sits at
     * the edge of the surface; the column is what a reader's eye tracks, and
     * what the composer has to line up with.
     */
    transcriptColumn(): Locator {
        return this.transcript().locator('> div').first();
    }

    /**
     * The composer's bordered box — the textarea's parent, which is the element
     * with the visible edges.
     */
    composerBox(): Locator {
        return this.composer().locator('..');
    }

    /** The composer's measured height, for the auto-grow assertions. */
    async composerHeight(): Promise<number> {
        const box = await this.composer().boundingBox();
        return box?.height ?? 0;
    }

    /**
     * The line under the box. It is the composer's live region as well as its
     * hint, so it carries the attach limit and the "waiting for uploads" state.
     */
    composerHint(): Locator {
        // By name: the transcript's own phase region is a second
        // `role="status"` in `main` (`ORT-116`), so a bare role is ambiguous.
        return this.main.getByRole('status', { name: 'Composer status' });
    }

    // --- attachments ------------------------------------------------------

    /** The paperclip. Absent on a surface that passes no attachment state. */
    attachButton(): Locator {
        return this.main.getByRole('button', { name: 'Attach files' });
    }

    /**
     * The staged-file row inside the composer.
     *
     * Named apart from the transcript's sent list on purpose — see the
     * composer's own message — so this handle cannot resolve a turn that has
     * already been sent.
     */
    stagedList(): Locator {
        return this.main.getByRole('list', { name: 'Files to send' });
    }

    /** Every staged chip, in the order it was added. */
    stagedChips(): Locator {
        return this.stagedList().getByRole('listitem');
    }

    /** One turn's sent chips, by the turn's position in the transcript. */
    sentAttachments(): Locator {
        return this.main.getByRole('list', { name: 'Attached files' });
    }

    /** Remove a staged file. The name is in the control's accessible name. */
    removeAttachment(name: string): Locator {
        return this.main.getByRole('button', { name: `Remove ${name}` });
    }

    // --- skills -----------------------------------------------------------

    /**
     * The skills button in the composer. Named "Skills" while nothing is
     * staged and "N skills" once something is — the count is in the accessible
     * name on purpose, because a colour-only signal for "this run behaves
     * differently" is no signal.
     */
    skillsButton(): Locator {
        return this.main.getByRole('button', {
            name: /^(Skills|\d+ skills?)$/
        });
    }

    /**
     * The picker popover. Radix gives `PopoverContent` `role="dialog"`, and it
     * is named by the panel's own title through `aria-labelledby` — the title
     * is a `<p>`, not a heading, because a popover this small does not belong
     * in the page's heading outline.
     */
    skillsPicker(): Locator {
        return this.page.getByRole('dialog', { name: 'Skills for this chat' });
    }

    /** Opens the picker and waits for it to be there. */
    async openSkills() {
        await this.skillsButton().click();
        await this.skillsPicker().waitFor();
    }

    /** One skill's checkbox in the picker, by its title. */
    skillOption(title: string): Locator {
        return this.skillsPicker().getByRole('checkbox', {
            name: new RegExp(title)
        });
    }

    /**
     * The staged-skill row inside the composer.
     *
     * A different accessible name from the transcript's sent list — the same
     * lesson the file lists learned: two lists in one view answering to one
     * name leave a screen-reader user unable to tell them apart.
     */
    stagedSkills(): Locator {
        return this.main.getByRole('list', { name: 'Skills for this chat' });
    }

    /** Every staged skill chip. */
    stagedSkillChips(): Locator {
        return this.stagedSkills().getByRole('listitem');
    }

    /** One turn's skill chips in the transcript. */
    sentSkills(): Locator {
        return this.main.getByRole('list', { name: 'Skills used' });
    }

    /** Drop a staged skill. Its title is in the control's accessible name. */
    removeSkill(title: string): Locator {
        return this.main.getByRole('button', {
            name: `Remove the ${title} skill`
        });
    }

    /** The rail's link to the skills page. Absent without the permission. */
    manageSkillsLink(): Locator {
        return this.page.getByRole('link', { name: 'Skills' });
    }

    /**
     * Attach files through the hidden `<input type=file>`.
     *
     * `setInputFiles` on the input rather than a click on the paperclip: the
     * click opens the OS picker, which Playwright cannot drive. The input is
     * `hidden`, so this needs no visibility wait.
     */
    async attachFiles(
        ...files: { name: string; mimeType: string; body: string }[]
    ) {
        await this.main.locator('input[type=file]').setInputFiles(
            files.map((file) => ({
                name: file.name,
                mimeType: file.mimeType,
                buffer: Buffer.from(file.body)
            }))
        );
    }

    /**
     * Build a `DataTransfer` carrying files, in the page.
     *
     * Drag and paste both need one, and neither can be produced from Node —
     * a `File` has to be constructed in the browser realm the handler will read
     * it in. Returned as a handle so the caller can pass it into `dispatchEvent`.
     */
    private async fileTransfer(
        files: { name: string; mimeType: string; body: string }[]
    ) {
        return this.page.evaluateHandle((items) => {
            // Reached through `globalThis` and typed by hand: this package's
            // tsconfig has no DOM lib (the specs drive a browser, they do not
            // compile against one), so bare `DataTransfer` and `File` do not
            // resolve here even though they exist in the page. Same idiom as
            // `CopilotDockPage.storedFrame`.
            const scope = globalThis as unknown as {
                DataTransfer: new () => {
                    items: { add(file: unknown): void };
                };
                File: new (
                    parts: string[],
                    name: string,
                    options: { type: string }
                ) => unknown;
            };
            const transfer = new scope.DataTransfer();
            for (const item of items) {
                transfer.items.add(
                    new scope.File([item.body], item.name, {
                        type: item.mimeType
                    })
                );
            }
            return transfer;
        }, files);
    }

    /** Drag files over the composer without dropping — for the highlight. */
    async dragFilesOver(
        ...files: { name: string; mimeType: string; body: string }[]
    ) {
        const transfer = await this.fileTransfer(files);
        await this.composer().dispatchEvent('dragenter', {
            dataTransfer: transfer
        });
    }

    /** Drop files onto the composer. */
    async dropFiles(
        ...files: { name: string; mimeType: string; body: string }[]
    ) {
        const transfer = await this.fileTransfer(files);
        await this.composer().dispatchEvent('dragenter', {
            dataTransfer: transfer
        });
        await this.composer().dispatchEvent('drop', {
            dataTransfer: transfer
        });
    }

    /**
     * Paste files into the composer, as pasting a screenshot does.
     *
     * Dispatched **inside the page** rather than through
     * `locator.dispatchEvent`, which builds the event from a name→constructor
     * map that has no `ClipboardEvent` in it: the event arrives as a plain
     * `Event` and `clipboardData` is dropped, so the handler sees no files and
     * the test passes for the wrong reason. Drop is unaffected — `DragEvent`
     * *is* in that map, which is why `dropFiles` above can stay declarative.
     */
    async pasteFiles(
        ...files: { name: string; mimeType: string; body: string }[]
    ) {
        await this.composer().evaluate((element, items) => {
            const scope = globalThis as unknown as {
                DataTransfer: new () => { items: { add(file: unknown): void } };
                File: new (
                    parts: string[],
                    name: string,
                    options: { type: string }
                ) => unknown;
                ClipboardEvent: new (
                    type: string,
                    init: Record<string, unknown>
                ) => unknown;
            };
            const transfer = new scope.DataTransfer();
            for (const item of items) {
                transfer.items.add(
                    new scope.File([item.body], item.name, {
                        type: item.mimeType
                    })
                );
            }
            (
                element as unknown as { dispatchEvent(event: unknown): void }
            ).dispatchEvent(
                new scope.ClipboardEvent('paste', {
                    clipboardData: transfer,
                    bubbles: true,
                    cancelable: true
                })
            );
        }, files);
    }

    /** The drop overlay, shown only while files are dragged over the box. */
    dropOverlay(): Locator {
        return this.main.getByText('Drop files to attach them');
    }

    // --- the attached page (the context chip, above the composer) ----------

    /**
     * The "Add context" button. Offered only where the URL has a page-level
     * context to give — inside the content library — and again after navigating
     * away from whatever is already attached, since an attachment is a snapshot.
     */
    addContext(): Locator {
        return this.main.getByRole('button', { name: 'Add context' });
    }

    /**
     * The chip naming what is attached, e.g. "article entry" or "article list".
     * Matched loosely because the chip also carries the locale when there is one.
     */
    contextChip(name: string | RegExp): Locator {
        return this.main.getByText(name);
    }

    /** The chip's `×`. */
    removeContext(): Locator {
        return this.main.getByRole('button', { name: 'Remove context' });
    }

    // --- the model picker (bottom-left of the composer) --------------------

    /** The picker's trigger. It shows the current choice — always a model. */
    modelPicker(): Locator {
        return this.main.getByRole('button', { name: 'Choose a model' });
    }

    /** Pick a backend by its model id (the item also names its provider). */
    async chooseModel(model: string) {
        await this.modelPicker().click();
        await this.page
            .getByRole('menuitem', { name: new RegExp(model) })
            .click();
    }

    // --- the dock ---------------------------------------------------------

    /** A chat's pill. Its name carries the marker ("— finished"). */
    dockPill(name: string | RegExp): Locator {
        return this.dock.getByRole('button', { name });
    }

    // --- toasts -----------------------------------------------------------

    /** A toast by its message. */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }
}
