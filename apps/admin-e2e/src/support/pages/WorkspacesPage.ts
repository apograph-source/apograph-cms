import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Workspaces page at `/workspaces` (from
 * `@orthacms/workspaces-admin`).
 *
 * Unlike the auth suites there is **no `/api` mock for the data**: the page
 * reads from the plugin's in-memory `workspacesClient` stub, whose seed is fixed
 * and resets with the browser context each test — so it is as deterministic as a
 * network mock. Tests still need `mockSignedIn` for the auth probe, since the
 * page lives behind the shell's gate.
 */
export class WorkspacesPage extends BasePage {
    /** The page's `<h1>`. */
    readonly heading: Locator;
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The search box (leading search icon). */
    readonly search: Locator;
    /** The workspaces table (scopes row/link lookups away from the sidebar). */
    readonly table: Locator;
    /**
     * The header "New workspace" CTA. An identical button appears in the empty
     * state, so this takes the first (the header is first in the DOM).
     */
    readonly newWorkspaceButton: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Workspaces',
            level: 1
        });
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.search = page.getByRole('searchbox', {
            name: 'Search workspaces'
        });
        this.table = page.getByRole('table', { name: 'Workspaces' });
        this.newWorkspaceButton = page
            .getByRole('button', { name: 'New workspace' })
            .first();
    }

    async goto() {
        await this.page.goto('/workspaces');
        await this.heading.waitFor();
    }

    /** The live "{shown} of {total}" count. */
    count(): Locator {
        return this.page.getByText(/^\d+ of \d+$/);
    }

    /**
     * The table loading skeleton — a `role="status"` region announcing
     * "Loading workspaces…", shown while the list query is in flight (seed it
     * with `mockWorkspaces(page, …, { delayMs })`).
     */
    listSkeleton(): Locator {
        return this.page
            .getByRole('status')
            .filter({ hasText: /Loading workspaces/ });
    }

    /**
     * A workspace row, located by its name link — scoped to the table so it
     * never matches the sidebar's Workspaces quick-list (same names).
     */
    card(name: string): Locator {
        return this.table.getByRole('row').filter({
            has: this.page.getByRole('link', { name, exact: true })
        });
    }

    /** The link that opens a workspace (its name), scoped to the table. */
    openButton(name: string): Locator {
        return this.table.getByRole('link', { name, exact: true });
    }

    /**
     * A row's avatar monogram — the initials derived on the client. The avatar
     * is a design-system `Avatar` (a Radix span pair with no role or test id),
     * so it is addressed as the first span of the row's first cell, ahead of
     * the name link.
     */
    monogram(name: string | RegExp): Locator {
        return this.table
            .getByRole('row')
            .filter({ hasText: name })
            .getByRole('cell')
            .first()
            .locator('span')
            .first();
    }

    // --- status filter chips (SegmentedControl → role=radio) ---

    statusOption(label: string): Locator {
        return this.page.getByRole('radio', { name: label });
    }

    /** Pick a status via its filter chip. */
    async filterByStatus(label: string) {
        await this.statusOption(label).click();
    }

    // --- error state ---

    /**
     * The table's "couldn't load workspaces" alert. The page renders exactly one
     * `role="alert"`, and it is the state that must never be confused with an
     * empty list — hence its own handle rather than an `emptyText` lookup.
     */
    errorAlert(): Locator {
        return this.page.getByRole('alert');
    }

    /** The Retry button inside that alert, which refetches the list. */
    retryButton(): Locator {
        return this.errorAlert().getByRole('button', { name: 'Retry' });
    }

    /**
     * The sidebar quick-list's one-line "couldn't load" note. A nav aid, so the
     * section says it quietly rather than with an alert — but it does say it,
     * instead of collapsing to a bare heading that reads as "you belong to no
     * workspace".
     */
    sidebarWorkspacesError(): Locator {
        return this.page.getByText('Couldn’t load your workspaces.');
    }

    /**
     * The workspace shell's centred message block. Both of its states — the
     * no-access screen and the "couldn't load workspaces" screen — render as a
     * single `role="alert"`, so this is also how a test compares their copy.
     */
    shellMessage(): Locator {
        return this.page.getByRole('alert');
    }

    /**
     * That message's copy, for a test that compares two screens rather than
     * matching a literal — an id that does not exist and one that is somebody
     * else's have to read the same.
     */
    async shellMessageText(): Promise<string> {
        return (await this.shellMessage().textContent()) ?? '';
    }

    // --- empty state ---

    emptyText(text: string): Locator {
        return this.page.getByText(text);
    }

    clearFiltersButton(): Locator {
        return this.page.getByRole('button', { name: 'Clear filters' });
    }

    // --- the sidebar "Workspaces" quick-list section ---

    /**
     * The quick-list group's heading, which doubles as its collapse trigger
     * (`aria-expanded` + `data-state` come from Radix `Collapsible`). Matched
     * exactly so it never resolves the sidebar's "Workspaces" nav *link* or the
     * page's own `<h1>` — both a different role, but the exact match also keeps
     * it off "New workspace".
     */
    get sidebarWorkspacesToggle(): Locator {
        return this.page.getByRole('button', {
            name: 'Workspaces',
            exact: true
        });
    }

    /**
     * The quick-list's `<nav>` landmark. Present **only while expanded** —
     * Radix unmounts the closed content, so this is also the check that the
     * collapsed rows left the tab order rather than merely going invisible.
     */
    get sidebarWorkspacesNav(): Locator {
        return this.page.getByRole('navigation', { name: 'Workspaces' });
    }

    /**
     * A workspace row inside the sidebar quick-list. **Not** an exact name
     * match: each row leads with a `WorkspaceAvatar` monogram that is not
     * `aria-hidden`, so the link's accessible name reads "MS Marketing site".
     */
    sidebarWorkspaceLink(name: string): Locator {
        return this.sidebarWorkspacesNav.getByRole('link', { name });
    }

    /**
     * The group's "+" action — a `SidebarGroupAction`, which is positioned
     * absolutely **over** the heading row, so this is what proves the collapse
     * trigger did not swallow it. A link, unlike the page header's identically
     * named button.
     */
    get sidebarNewWorkspaceAction(): Locator {
        return this.page.getByRole('link', { name: 'New workspace' });
    }

    /**
     * Expand the quick-list **idempotently** — it ships open, so a bare click
     * would collapse it. Reads `aria-expanded` first, then waits until it has
     * settled open.
     */
    async expandSidebarWorkspaces() {
        const trigger = this.sidebarWorkspacesToggle;
        await trigger.waitFor();
        if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
            await trigger.click();
        }
        await this.sidebarWorkspacesNav.waitFor();
    }

    /** Collapse the quick-list idempotently. */
    async collapseSidebarWorkspaces() {
        const trigger = this.sidebarWorkspacesToggle;
        await trigger.waitFor();
        if ((await trigger.getAttribute('aria-expanded')) === 'true') {
            await trigger.click();
        }
        await this.sidebarWorkspacesNav.waitFor({ state: 'hidden' });
    }

    // --- create ---

    /** Open the create wizard — a full page at `/workspaces/new`, not a dialog. */
    async openCreate() {
        await this.newWorkspaceButton.click();
    }

    /** A toast message (sonner, portaled to the body). */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }
}
