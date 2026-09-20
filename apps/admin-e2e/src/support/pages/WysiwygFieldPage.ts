import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the **rich-text field** — the WYSIWYG plugin's
 * (`@orthacms/wysiwyg-admin`) `ENTRY_FIELD_CONTROL_SLOT` contribution: a
 * preview of the stored content in the entry form, expanding into a TipTap
 * editor that takes over the entry editor's **work area**.
 *
 * It is a view, not a dialog — so there is no `dialog` role to wait on. The
 * toolbar's arrival is the signal that the editor is up, and the record's own
 * chrome (top-bar actions, Properties rail, app sidebar) is expected to still
 * be on screen beside it.
 *
 * Seed with `mockSignedIn`, `mockWorkspaces`, and the `WYSIWYG_*` content mocks
 * (their schema is what makes the plugin claim the field), plus `spyEntrySave`
 * for anything that asserts the HTML actually stored.
 */
export class WysiwygFieldPage extends BasePage {
    /** The expanded editor's toolbar — present only while a field is expanded. */
    readonly toolbar: Locator;
    /** The entry editor's tab strip — present only while the form is showing. */
    readonly editorTabs: Locator;
    /** The record's Properties rail, in the app's third column. */
    readonly propertiesPanel: Locator;
    /** The workspace's content navigation, in the app sidebar. */
    readonly contentNav: Locator;

    constructor(page: Page) {
        super(page);
        this.toolbar = page.getByRole('group', { name: 'Formatting' });
        this.editorTabs = page.getByRole('tab', { name: 'General' });
        this.propertiesPanel = page.getByRole('complementary', {
            name: 'Properties'
        });
        this.contentNav = page.getByRole('navigation', {
            name: 'Content types'
        });
    }

    /** Open the create editor for the seeded `article` collection. */
    async gotoNewArticle(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/content/article/new`);
    }

    /** Open an existing record's editor. */
    async gotoArticle(workspaceId: string, entryId: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/content/article/${entryId}`
        );
    }

    /**
     * A rich-text field's control — the button laid over the preview, named
     * "Edit {label}". This is the field's focusable element, so it is also what
     * the field's `<label>` points at.
     */
    control(label: string): Locator {
        return this.page.getByRole('button', { name: `Edit ${label}` });
    }

    /**
     * The same control in a **read-only** editor, where it is named "View
     * {label}" — the expansion is kept (a clamped preview can't show a long
     * body) but it opens a reading surface, not an editor.
     */
    viewControl(label: string): Locator {
        return this.page.getByRole('button', { name: `View ${label}` });
    }

    /**
     * The rendered preview for a field, located by walking up from its control
     * to the shared card. Used to assert the field shows *content* — a heading,
     * a list — rather than the markup that produced it.
     */
    preview(label: string): Locator {
        return this.control(label).locator('..');
    }

    /**
     * The same card in a **read-only** editor, where the button over it is
     * named "View {label}" rather than "Edit {label}".
     */
    viewPreview(label: string): Locator {
        return this.viewControl(label).locator('..');
    }

    /**
     * What a link becomes in the collapsed preview: a `<span data-link>`. The
     * preview sits under a full-bleed button, so a live `<a>` inside it would
     * be a tab stop the reader falls into on the way to that button — and
     * pressing it would navigate out of the record.
     */
    previewFlattenedLinks(label: string): Locator {
        return this.preview(label).locator('[data-link]');
    }

    /**
     * Anything in the collapsed preview matching a raw CSS `selector`.
     *
     * The trust-boundary assertions are about **markup** — an `onerror`
     * attribute, an `<iframe>`, a `javascript:` href — and none of those has a
     * role or a label to locate it by. What is being asserted *is* the
     * selector, so it belongs in the spec rather than behind a name here.
     */
    previewMarkup(label: string, selector: string): Locator {
        return this.preview(label).locator(selector);
    }

    /** Expand a field into the work area, and wait for the editor to arrive. */
    async open(label: string): Promise<void> {
        await this.control(label).click();
        await this.toolbar.waitFor();
        await this.waitForCaret(label);
    }

    /**
     * Wait until the caret is actually **in the document**.
     *
     * The toolbar is not that signal, though it looks like one: it renders as
     * soon as the editor object exists, while TipTap applies `autofocus: 'end'`
     * to the ProseMirror view a tick later. Typing in that gap sends keystrokes
     * to whatever still holds focus, and they are simply lost — so the failure
     * is a *prefix* of the text going missing ("Hello there" arriving as "ello
     * there"), which reads as a broken editor rather than a race. How much is
     * lost depends on machine load, so it fails a few runs in a hundred.
     */
    private async waitForCaret(label: string): Promise<void> {
        await expect(this.surface(label)).toBeFocused();
    }

    /** The expanded editor's heading — the field's label, below the record's. */
    expandedHeading(label: string): Locator {
        return this.page.getByRole('heading', { name: label, exact: true });
    }

    /** A table inside the expanded editor's document. */
    get editorTable(): Locator {
        return this.page.getByRole('table');
    }

    /**
     * The editor's writing surface. It is a `textbox` named "{label} content",
     * so it never collides with the entry form's own text inputs.
     */
    surface(label: string): Locator {
        return this.page.getByRole('textbox', { name: `${label} content` });
    }

    /**
     * The same surface in a **read-only** view, where it is a labelled
     * `region` and not a `textbox` — a textbox that takes no text misdescribes
     * what is on screen, and `aria-multiline` / `aria-required` mean nothing on
     * something a reader cannot fill.
     */
    readingSurface(label: string): Locator {
        return this.page.getByRole('region', { name: `${label} content` });
    }

    /**
     * **Every** editing surface currently mounted anywhere on the page, by the
     * attributes the panel puts on its own document rather than by a name.
     *
     * The count is the assertion: the panel is mounted only while its field is
     * unfolded, and only one field is unfolded at a time — a panel kept alive
     * behind `display: none`, or a second field's panel mounted beside the
     * first, both show up here and nowhere else. A role query would not do:
     * `getByRole('textbox')` also matches the record's own `<input>`s.
     */
    get editorSurfaces(): Locator {
        return this.surfaceRoot;
    }

    /** The rows of the table in the expanded editor's document. */
    get editorTableRows(): Locator {
        return this.editorTable.getByRole('row');
    }

    /**
     * The last ordinary (non-header) cell of the table in the document —
     * where `Tab` stops walking and starts appending.
     */
    get editorTableLastCell(): Locator {
        return this.editorTable.getByRole('cell').last();
    }

    /** Press `Tab` `times` times, from wherever focus currently is. */
    async pressTab(times = 1): Promise<void> {
        for (let i = 0; i < times; i += 1) {
            await this.page.keyboard.press('Tab');
        }
    }

    /**
     * The text the **browser** currently has selected — not the editor's own
     * idea of it.
     *
     * That distinction is the point wherever a toolbar press is involved: a
     * `mousedown` whose default action runs moves focus and collapses the
     * document's selection, and only the live DOM selection shows it. Spelled
     * out locally because this project's `tsconfig` has no `dom` lib.
     */
    async selectedText(): Promise<string> {
        return this.page.evaluate(() => {
            type SelectionHost = {
                getSelection?: () => { toString(): string } | null;
            };
            const host = globalThis as unknown as SelectionHost;
            return host.getSelection?.()?.toString() ?? '';
        });
    }

    /**
     * Press the mouse **down** on a control and hold it — the half of a click
     * that carries `mousedown`, and the only moment at which suppressing its
     * default action is observable. Release with {@link releaseMouse}.
     */
    async pressMouseOn(target: Locator): Promise<void> {
        await target.hover();
        await this.page.mouse.down();
    }

    /** Release a press started by {@link pressMouseOn}. */
    async releaseMouse(): Promise<void> {
        await this.page.mouse.up();
    }

    /** Type into the editor at the caret (which opens at the end of the text). */
    async type(text: string): Promise<void> {
        await this.page.keyboard.type(text);
    }

    /**
     * The **effective** `lang` on an element — the nearest one an ancestor
     * declares, which is what a screen reader actually resolves. Asserting the
     * attribute on the element itself would miss the whole mechanism: the
     * collapsed field inherits its language from the form's Translated group,
     * and only the expanded view sets one of its own.
     *
     * Falls back to `<html lang>`, which the admin hardcodes to `en` — so a
     * surface that claims nothing reports `'en'` rather than `null`, and a spec
     * can tell "inherited the chrome's language" apart from "no language at
     * all". `LangHost` is the shape the callback touches, spelled out locally
     * because this project's `tsconfig` has no `dom` lib.
     */
    async resolvedLang(target: Locator): Promise<string | null> {
        type LangHost = {
            getAttribute(name: string): string | null;
            parentElement: LangHost | null;
        };
        return target.evaluate((element) => {
            let node = element as unknown as LangHost | null;
            while (node) {
                const value = node.getAttribute('lang');
                if (value) return value;
                node = node.parentElement;
            }
            return null;
        });
    }

    /**
     * The text an element's `aria-describedby` points at — what a screen reader
     * reads out after the surface's own name. Resolved through the attribute
     * rather than by locating the paragraph directly, because the whole claim is
     * that the description is *wired up*, not merely present in the DOM.
     */
    async describedText(target: Locator): Promise<string> {
        const id = await target.getAttribute('aria-describedby');
        if (!id) return '';
        // An attribute selector rather than `#id`: React's `useId` emits ids
        // wrapped in guillemets (`«r7»`), which are not valid in a CSS id
        // selector without escaping.
        return (
            (await this.page.locator(`[id="${id}"]`).textContent())?.trim() ??
            ''
        );
    }

    /**
     * The chord that takes focus out of the document — `Ctrl+M`, and not `Mod`,
     * because on macOS `Mod` is ⌘ and ⌘M minimizes the window.
     */
    async pressEscapeChord(): Promise<void> {
        await this.page.keyboard.press('Control+m');
    }

    /**
     * Press the workspace content palette's ⌘K / Ctrl+K chord wherever focus
     * currently is — the point being that the binding is on `window`, so it
     * fires from inside the editor too unless something yields it.
     */
    async pressSearchChord(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+k');
    }

    /**
     * The nearest declared text direction, same walk as {@link resolvedLang}.
     * `dir="auto"` is the answer the form gives: order each field's own bidi
     * text from its content rather than from the admin's chrome.
     */
    async resolvedDir(target: Locator): Promise<string | null> {
        type DirHost = {
            getAttribute(name: string): string | null;
            parentElement: DirHost | null;
        };
        return target.evaluate((element) => {
            let node = element as unknown as DirHost | null;
            while (node) {
                const value = node.getAttribute('dir');
                if (value) return value;
                node = node.parentElement;
            }
            return null;
        });
    }

    /** Empty the open editor — select everything, delete it. */
    async clearAll(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+a');
        await this.page.keyboard.press('Backspace');
    }

    /** Open a field's editor the way a keyboard user would. */
    async openWithKeyboard(label: string): Promise<void> {
        await this.control(label).focus();
        await this.page.keyboard.press('Enter');
        await this.toolbar.waitFor();
        await this.waitForCaret(label);
    }

    /** A toolbar toggle/action by its accessible name (e.g. "Bold"). */
    toolbarButton(name: string): Locator {
        return this.toolbar.getByRole('button', { name, exact: true });
    }

    /** Open one of the toolbar's dropdowns (e.g. "Insert", "Alignment"). */
    async openToolbarMenu(name: string): Promise<void> {
        await this.toolbarButton(name).click();
    }

    /**
     * Open the **Insert** menu and step into one of its submenus ("Table",
     * "Columns", "Callout"). The block-insertion controls live behind one
     * trigger so the toolbar stays a single row.
     */
    async openInsertSubmenu(name: string): Promise<void> {
        await this.openToolbarMenu('Insert');
        await this.page.getByRole('menuitem', { name, exact: true }).click();
    }

    /**
     * How many rows the toolbar wraps onto — 1 unless the window is narrow.
     *
     * `MeasuredBar` is the shape of what the callback touches, spelled out
     * locally: this project's `tsconfig` has no `dom` lib (specs are black-box
     * and otherwise never name a DOM type), so `HTMLElement` doesn't resolve
     * here even though the callback runs in the browser.
     */
    async toolbarRowCount(): Promise<number> {
        type MeasuredBar = {
            children: ArrayLike<{
                getBoundingClientRect(): { top: number; height: number };
            }>;
        };
        return this.toolbar.evaluate((element) => {
            const bar = element as unknown as MeasuredBar;
            // Rows are grouped by vertical **centre**, not by `top`. The bar is
            // `items-center` and its children are different heights (a 32px
            // button beside a 20px separator), so same-row items have different
            // tops — counting those reports four rows for a bar that renders
            // one.
            const centres = new Set<number>();
            for (const child of Array.from(bar.children)) {
                const box = child.getBoundingClientRect();
                // Round: sub-pixel layout differences are not extra rows.
                centres.add(Math.round(box.top + box.height / 2));
            }
            return centres.size;
        });
    }

    /**
     * Open **Insert ▸ Media**, then one of its entries — the contributed
     * sources ("Media Library…", "Upload files…") or a built-in URL entry.
     */
    async openMediaSource(name: string | RegExp): Promise<void> {
        await this.openInsertSubmenu('Media');
        await this.page.getByRole('menuitem', { name }).click();
    }

    /** An image inside the expanded editor's document. */
    editorImage(alt: string | RegExp): Locator {
        return this.surfaceRoot.getByRole('img', { name: alt });
    }

    /** Every `<video>` in the expanded editor's document. */
    get editorVideos(): Locator {
        return this.surfaceRoot.locator('video');
    }

    /**
     * The `<figure>` a media node renders as inside the editor. It is what
     * carries the author's width and alignment on screen — the bare `<img>` in
     * the stored HTML carries the same values.
     */
    get editorFigure(): Locator {
        return this.surfaceRoot.locator('figure');
    }

    /** Open the toolbar's alignment menu and choose one of its options. */
    async align(name: string): Promise<void> {
        await this.openToolbarMenu('Alignment');
        await this.menuRadio(name).click();
    }

    /**
     * The alt-text control on an image in the document. Its name is the prompt:
     * "Add alt text" while the image has neither alt nor a decorative mark,
     * "Alt text" once the author has answered either way.
     */
    altControl(name: 'Add alt text' | 'Alt text'): Locator {
        return this.page.getByRole('button', { name, exact: true });
    }

    /** Open the alt popover, type a description, and save. */
    async setAltText(text: string): Promise<void> {
        await this.page
            .getByRole('button', { name: /^(Add alt text|Alt text)$/ })
            .click();
        await this.page.getByLabel('Describe this image').fill(text);
        await this.page.getByRole('button', { name: 'Save' }).click();
    }

    /** Open the alt popover, tick "Decorative", and save. */
    async markAltDecorative(): Promise<void> {
        await this.page
            .getByRole('button', { name: /^(Add alt text|Alt text)$/ })
            .click();
        await this.page.getByRole('checkbox', { name: /^Decorative/ }).check();
        await this.page.getByRole('button', { name: 'Save' }).click();
    }

    /** Open the toolbar's link popover. */
    async openLinkPopover(): Promise<void> {
        await this.toolbarButton('Link').click();
    }

    /** Type a URL into the open link popover and apply it. */
    async applyLink(url: string): Promise<void> {
        await this.page.getByLabel('URL').fill(url);
        await this.page.getByRole('button', { name: 'Apply' }).click();
    }

    /** The resize handle on the selected media node. */
    get resizeHandle(): Locator {
        return this.page.getByRole('button', { name: /^Resize/ });
    }

    /** The built-in "from a URL" dialog. */
    private get mediaUrlDialog(): Locator {
        return this.page.getByRole('dialog', { name: /from a URL$/ });
    }

    /** Fill the URL dialog and submit it. */
    async fillMediaUrl(url: string, alt?: string): Promise<void> {
        await this.mediaUrlDialog.getByLabel('URL').fill(url);
        if (alt !== undefined) {
            await this.mediaUrlDialog.getByLabel('Alt text').fill(alt);
        }
        await this.mediaUrlDialog
            .getByRole('button', { name: 'Insert' })
            .click();
    }

    /** The URL dialog's validation message. */
    get mediaUrlError(): Locator {
        return this.mediaUrlDialog.getByRole('alert');
    }

    /**
     * Pick one asset in the Media Library picker and confirm. The picker is
     * `@orthacms/media-admin`'s own — the same one a media *field* opens.
     */
    async pickLibraryAsset(name: string): Promise<void> {
        const picker = this.page.getByRole('dialog', { name: 'Select assets' });
        await picker
            .getByRole('button', { name: new RegExp(name.replace('.', '\\.')) })
            .click();
        await picker.getByRole('button', { name: 'Add selected' }).click();
        await picker.waitFor({ state: 'hidden' });
    }

    /** Nudge the focused resize handle, one arrow-key press at a time. */
    async nudgeResize(
        direction: 'ArrowLeft' | 'ArrowRight',
        times = 1
    ): Promise<void> {
        await this.resizeHandle.focus();
        for (let i = 0; i < times; i += 1) {
            await this.page.keyboard.press(direction);
        }
    }

    /** The editor's writing surface, as a plain element for content queries. */
    private get surfaceRoot(): Locator {
        return this.page.locator('[role="textbox"][aria-multiline="true"]');
    }

    /** An item inside an open toolbar dropdown. */
    menuItem(name: string): Locator {
        return this.page.getByRole('menuitem', { name, exact: true });
    }

    /** A radio item inside an open toolbar dropdown (text style, size, columns). */
    menuRadio(name: string): Locator {
        return this.page.getByRole('menuitemradio', { name, exact: true });
    }

    /**
     * A rich-text field's validation message, by the field's machine name.
     * Anchored on the id `EntryFieldInput` gives its `<FieldError>` — the bare
     * `role="alert"` is shared by every field on the form.
     */
    fieldError(fieldName: string): Locator {
        return this.page.locator(`#entry-field-${fieldName}-error`);
    }

    /**
     * The expanded view's word/character read-out ("5 words · 26 characters").
     * Worth asserting rather than eyeballing: it is fed by `useEditorState`,
     * which only refreshes on an editor transaction — so a surface that fires
     * none (the read-only view) can sit on a stale, empty first snapshot and
     * report 0 over a full document.
     */
    get counts(): Locator {
        return this.page.getByText(/\d+ words? · \d+ characters?/);
    }

    /**
     * The footer's exit button. Its label is the mode: **Done** while editing,
     * **Back to fields** in the read-only view, where "done" would name the end
     * of an editing session the reader never began.
     */
    exitButton(label: 'Done' | 'Back to fields'): Locator {
        return this.page.getByRole('button', { name: label });
    }

    /** Collapse back to the form via the editor's footer action. */
    async done(): Promise<void> {
        await this.exitButton('Done').click();
        await this.toolbar.waitFor({ state: 'hidden' });
    }

    /**
     * The editor's accessibility findings, under the document — the structural
     * rules (`inspectRichText`) read live as the body is written.
     */
    get issues(): Locator {
        return this.page.getByRole('listitem').filter({ hasText: /WCAG/ });
    }

    /**
     * The language-of-parts dialog, open.
     *
     * Exposed because a spec asserting the dialog's *rejection* of a bad tag
     * needs the dialog while it is still up — {@link setPassageLanguage} waits
     * for it to close, which never happens on a value it refuses. Reaching for
     * `page` from the spec is not the alternative: it is `protected`, and a spec
     * that touches it stops the whole suite typechecking.
     */
    get languageDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /**
     * Mark the current selection as being written in `tag`, through the
     * language-of-parts dialog behind **More formatting**.
     */
    async setPassageLanguage(tag: string): Promise<void> {
        await this.openToolbarMenu('More formatting');
        await this.menuItem('Language of this passage…').click();
        const dialog = this.page.getByRole('dialog');
        await dialog.getByLabel('Language tag').fill(tag);
        await dialog.getByRole('button', { name: 'Apply' }).click();
        await dialog.waitFor({ state: 'hidden' });
    }

    /** Select everything in the open editor, without clearing it. */
    async selectAll(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+a');
    }

    /** Collapse back to the form via the editor's header link. */
    async backToFields(): Promise<void> {
        await this.page.getByRole('button', { name: 'Back to fields' }).click();
        await this.toolbar.waitFor({ state: 'hidden' });
    }
}
