import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the **docked panel** (`@orthacms/copilot-admin`) — the
 * bottom-right dock, the windows it opens, and their chrome. Seed it with
 * `mockSignedIn`, `mockWorkspaces` and `mockCopilotApi`, then open any page
 * inside a workspace: the dock is contributed to the sidebar's footer slot and
 * portalled to `<body>`, so it is there on every workspace page.
 *
 * The sibling of {@link AgentsPage}, which covers the full-page surface. The two
 * share their transcript, composer and cards; what only exists here is the
 * window — several at once, tiled, collapsible to a pill, movable, and each one
 * carrying a run that must not be cancelled by anything except closing it.
 *
 * **Every window answers to the same accessible name** ("Ortha AI"), because the
 * header's visible title is a heading rather than the dialog's label. So windows
 * are addressed by index, in the order they were opened.
 */
export class CopilotDockPage extends BasePage {
    /** The bottom bar: one pill per chat, plus the way to start another. */
    readonly dock: Locator;

    constructor(page: Page) {
        super(page);
        // A `complementary`, not a `toolbar`: the role was downgraded once it
        // was clear the dock implements none of the composite-widget keyboard
        // model a toolbar promises (no roving tabindex, no arrow keys) — every
        // pill is its own tab stop. It became a **landmark** rather than a plain
        // `group` because the dock is portalled to `<body>`, so without one its
        // pills sat outside every landmark on the page (`ORT-170`).
        this.dock = page.getByRole('complementary', {
            name: 'Ortha AI chats'
        });
    }

    // --- the dock ---------------------------------------------------------

    /**
     * The dock's start control. With no chats open it is a labelled Ortha AI
     * button carrying the platform's shortcut hint; once there are pills it
     * shrinks to a `+`.
     *
     * Its accessible name is "Ortha AI — new chat" while it shows that label and
     * "New chat" once it is a bare `+`. Matched by substring (Playwright's
     * default, case-insensitively), so one locator covers both — and the empty
     * form deliberately *contains* its visible text, which is the 2.5.3 property
     * the earlier constant "New chat" broke.
     */
    newChat(): Locator {
        return this.dock.getByRole('button', { name: 'new chat' });
    }

    /** Start a chat from the dock. */
    async startChat() {
        await this.newChat().click();
    }

    /**
     * A chat's pill. The marker is **in the name** — "… — finished", "… —
     * waiting for you" — not only in the coloured dot, so pass a regex to assert
     * one.
     *
     * A plain name matches **exactly**: role names are substring-matched by
     * default, and every pill sits beside a "Close {title}" control that would
     * otherwise match the same string.
     */
    pill(name: string | RegExp): Locator {
        return this.dock.getByRole('button', {
            name,
            ...(typeof name === 'string' ? { exact: true } : {})
        });
    }

    /** Every pill and close control in the bar — for counting chats. */
    pills(): Locator {
        return this.dock.getByRole('button');
    }

    /** A pill's own Close control, named after the chat it discards. */
    closePill(title: string): Locator {
        return this.dock.getByRole('button', { name: `Close ${title}` });
    }

    // --- the windows ------------------------------------------------------

    /**
     * Every open window, in the order they were opened.
     *
     * Resolved by the move grip rather than by name: a window is now named by
     * its own `<h2>` — the thread's title — so that three open windows are
     * distinguishable in a screen reader's dialog list instead of being three
     * identical "Ortha AI"s. That means the name is no longer a constant to
     * match on, and the grip is the one control every panel has and nothing
     * else does.
     */
    windows(): Locator {
        return this.page.getByRole('dialog').filter({
            has: this.page.getByRole('button', { name: 'Move Ortha AI' })
        });
    }

    /** One window by index. */
    panel(index = 0): Locator {
        return this.windows().nth(index);
    }

    /** A window's header control ("Minimize", "Close", "Expand" / "Shrink"). */
    headerButton(name: string | RegExp, index = 0): Locator {
        return this.panel(index).getByRole('button', { name });
    }

    /** The keyboard move grip at the head of the header. */
    moveHandle(index = 0): Locator {
        return this.headerButton('Move Ortha AI', index);
    }

    /** The window's visible title — the thread's name, or "Ortha AI". */
    panelTitle(index = 0): Locator {
        return this.panel(index).getByRole('heading');
    }

    /** The window's message box. */
    composer(index = 0): Locator {
        return this.panel(index).getByRole('textbox', {
            name: 'Ask about your content…'
        });
    }

    /** Type a turn into a window and send it. */
    async ask(text: string, index = 0) {
        await this.composer(index).fill(text);
        await this.composer(index).press('Enter');
    }

    /** The window's transcript. */
    transcript(index = 0): Locator {
        return this.panel(index).getByRole('log', { name: 'Conversation' });
    }

    /**
     * The model picker, bottom-left of the window's composer — the same place
     * the Agents view keeps it. Panel-scoped rather than header-scoped, so the
     * locator is indifferent to which row it rides in.
     */
    modelPicker(index = 0): Locator {
        return this.headerButton('Choose a model', index);
    }

    /** Pick a backend by model id. */
    async chooseModel(model: string, index = 0) {
        await this.modelPicker(index).click();
        await this.page
            .getByRole('menuitem', { name: new RegExp(model) })
            .click();
    }

    // --- the attached page (the context chip, above the composer) ----------

    /**
     * The window's "Add context" button. Rendered only where the URL has a
     * page-level context to offer, and offered again once the user has navigated
     * somewhere else — an attachment is a snapshot, replaceable without first
     * removing it.
     */
    addContext(index = 0): Locator {
        return this.panel(index).getByRole('button', { name: 'Add context' });
    }

    /** The chip naming what this window has attached. */
    contextChip(name: string | RegExp, index = 0): Locator {
        return this.panel(index).getByText(name);
    }

    /** The chip's `×`. */
    removeContext(index = 0): Locator {
        return this.panel(index).getByRole('button', {
            name: 'Remove context'
        });
    }

    /** The history dropdown — the panel's equivalent of the Agents rail. */
    historyPicker(index = 0): Locator {
        return this.headerButton('Previous chats', index);
    }

    /** Open a persisted thread from the history dropdown. */
    async openFromHistory(title: string, index = 0) {
        await this.historyPicker(index).click();
        await this.page.getByRole('menuitem', { name: title }).click();
    }

    // --- geometry ---------------------------------------------------------

    /**
     * A window's rectangle, once it has stopped moving.
     *
     * `boundingBox()` does not wait for animations, and the panel opens with a
     * 200ms scale/translate transition — so a naive read lands mid-flight and
     * measures a window that is still 95% of its size. Polling until two reads
     * agree is what makes the geometry assertions about geometry rather than
     * about timing.
     */
    async box(index = 0) {
        const locator = this.panel(index);
        let previous = await locator.boundingBox();
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            const next = await locator.boundingBox();
            if (
                previous &&
                next &&
                next.x === previous.x &&
                next.y === previous.y &&
                next.width === previous.width &&
                next.height === previous.height
            ) {
                return next;
            }
            previous = next;
        }
        if (!previous) throw new Error(`window ${index} has no box`);
        return previous;
    }

    /**
     * Drag a window by its header.
     *
     * Through the **grip**, not the header's empty space: the header ignores a
     * pointerdown that lands on a button, and the grip is the one button that is
     * deliberately a drag surface too.
     */
    async dragBy(dx: number, dy: number, index = 0) {
        const handle = this.moveHandle(index);
        const box = await handle.boundingBox();
        if (!box) throw new Error('no move handle');
        const from = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2
        };
        await this.page.mouse.move(from.x, from.y);
        await this.page.mouse.down();
        // Two moves: pointer capture only starts delivering after the first, and
        // a single jump can be coalesced into the press on some platforms.
        await this.page.mouse.move(from.x + dx / 2, from.y + dy / 2);
        await this.page.mouse.move(from.x + dx, from.y + dy);
        await this.page.mouse.up();
    }

    /** The geometry remembered for a window slot, or `null` if unplaced. */
    async storedFrame(slot = 0): Promise<unknown> {
        return this.page.evaluate((key) => {
            // Reached through `globalThis` and typed by hand: this package's
            // tsconfig has no DOM lib (the specs drive a browser, they do not
            // compile against one), so a bare `window` does not resolve here
            // even though it does in the page.
            const { localStorage } = globalThis as unknown as {
                localStorage: { getItem(key: string): string | null };
            };
            const raw = localStorage.getItem(key);
            return raw ? (JSON.parse(raw) as unknown) : null;
        }, `ortha.copilot.panel-frame.${slot}`);
    }
}
