import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Activity Log at `/activity` (from
 * `@ortha/activity-admin`).
 *
 * Data comes from the `GET /api/activity` mock (`mockActivity`); tests also
 * need `mockSignedIn` for the shell's auth probe. The page (and its nav entry)
 * gate on the signed-in user's `activity:read` permission.
 */
export class ActivityLogPage extends BasePage {
    /** The page's `<h1>`. */
    readonly heading: Locator;
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The Activity entry in the primary nav (an icon button, labelled). */
    readonly navButton: Locator;
    /** The actor-email search box. */
    readonly emailSearch: Locator;
    /** The audit-log table. */
    readonly table: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Activity',
            level: 1
        });
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.navButton = this.nav.getByRole('button', { name: 'Activity' });
        this.emailSearch = page.getByRole('searchbox', {
            name: 'Search by actor email'
        });
        this.table = page.getByRole('table', { name: 'Activity log' });
    }

    async goto() {
        await this.page.goto('/activity');
    }

    /**
     * Open the page with a query string — the URL is the source of truth for
     * every filter and page here, so deep links are a first-class entry point
     * (and the only way to reach a hand-edited, out-of-range param).
     */
    async gotoWith(search: string) {
        await this.page.goto(`/activity?${search}`);
    }

    /** A table row located by any visible text it contains (email, action…). */
    row(text: string): Locator {
        return this.page.getByRole('row').filter({ hasText: text });
    }

    /** The expand/collapse toggle inside a row matched by its visible text. */
    expandToggle(rowText: string): Locator {
        return this.row(rowText)
            .getByRole('button', { name: /details/i })
            .first();
    }

    /** Expands the first row containing `rowText` to reveal its details panel. */
    async expandRow(rowText: string) {
        await this.expandToggle(rowText).click();
    }

    /** Clicks a row's body (not the toggle button) to expand/collapse it. */
    async clickRowBody(rowText: string) {
        await this.row(rowText)
            .getByText(rowText, { exact: false })
            .first()
            .click();
    }

    /** The table loading skeleton — a `role="status"` region. */
    tableSkeleton(): Locator {
        return this.page
            .getByRole('status')
            .filter({ hasText: /Loading activity/ });
    }

    /** The no-access empty state heading (shown without `activity:read`). */
    noAccessText(): Locator {
        return this.page.getByText('You don’t have access to the activity log');
    }

    /** The empty-state heading shown when filters match nothing. */
    emptyText(label: string): Locator {
        return this.page.getByText(label, { exact: true });
    }

    /** The "Clear filters" button inside the filtered empty state. */
    clearFilters(): Locator {
        return this.page.getByRole('button', { name: 'Clear filters' });
    }

    /**
     * The page's polite results live region — the sr-only `role="status"` that
     * tells AT what a filter or a page change did. Scoped away from the
     * skeleton's `role="status"`, which only exists while pending.
     */
    resultsStatus(): Locator {
        return this.page
            .getByRole('status')
            .filter({ hasText: /events? found/ });
    }

    /** The pagination button by its accessible name. */
    pageButton(name: 'Previous page' | 'Next page'): Locator {
        return this.page.getByRole('button', { name });
    }

    /** The error state's alert (distinct from the empty state). */
    errorAlert(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: /Couldn’t load/ });
    }

    /**
     * The dead-letter banner — the "N actions were not recorded" warning above
     * the toolbar.
     *
     * Anchored on its title text rather than on `role="alert"` alone: the
     * page's own load-failure banner shares that role, and the two say opposite
     * things about whether the table below can be trusted.
     */
    deadLetterNotice(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: /(was|were) not recorded/ });
    }

    /** The banner's button that opens the dead-letter dialog. */
    deadLettersTrigger(): Locator {
        return this.page.getByRole('button', { name: 'Review and retry' });
    }

    /** The dead-letter dialog itself, named by its `DialogTitle`. */
    deadLettersDialog(): Locator {
        return this.page.getByRole('dialog', {
            name: 'Events that were not recorded'
        });
    }

    /** The dialog's table of parked events. */
    deadLettersTable(): Locator {
        return this.deadLettersDialog().getByRole('table');
    }

    /**
     * One row's Retry button, found by the row-scoped accessible name the
     * dialog gives it ("Retry {kind} from {when}") — not by five identical
     * "Retry"s, which is the point of the name existing.
     */
    deadLetterRetry(kind: string): Locator {
        return this.deadLettersDialog().getByRole('button', {
            name: new RegExp(`^Retry ${kind.replace(/\./g, '\\.')} from `)
        });
    }

    /** Every Retry button currently in the dialog. */
    deadLetterRetryButtons(): Locator {
        return this.deadLettersDialog().getByRole('button', {
            name: /^Retry .+ from /
        });
    }

    /** The dialog's own error state (distinct from its empty table). */
    deadLettersError(): Locator {
        return this.deadLettersDialog()
            .getByRole('alert')
            .filter({ hasText: /Couldn’t load the parked events/ });
    }

    /** The dialog's "Try again" button, inside that error state. */
    deadLettersReload(): Locator {
        return this.deadLettersDialog().getByRole('button', {
            name: 'Try again'
        });
    }

    /** The dialog's footer count ("Showing N events of M."). */
    deadLettersCount(): Locator {
        return this.deadLettersDialog().getByText(/^Showing /);
    }

    /**
     * Dismiss the dead-letter dialog with Escape.
     *
     * Escape rather than a click, because **two** controls in it are named
     * "Close" — the header's `DialogContent` X and the footer's button — so a
     * locator by name is a strict-mode violation rather than an action. Radix
     * closes on Escape and hands focus back through the notice's `triggerRef`,
     * which is the path a keyboard user takes anyway.
     */
    async closeDeadLettersDialog(): Promise<void> {
        await this.page.keyboard.press('Escape');
    }

    /**
     * Refetch what the page holds the way a returning tab does — the
     * background refresh nobody asked for.
     *
     * `visibilitychange` on **`window`** is the only event TanStack Query's
     * focus manager listens to (it dropped the `focus` listener in v5), so
     * dispatching anything else would silently do nothing and a test would pass
     * by never having refetched. No clock games are needed here, unlike the
     * session probe in `private-routes.spec.ts`: the dead-letter query takes
     * the default `staleTime` of 0, so it is stale the instant it resolves.
     */
    async refetchOnWindowFocus(): Promise<void> {
        await this.page.evaluate(() => {
            // Typed inline through `globalThis`: this project's tsconfig ships
            // no DOM lib.
            const browser = globalThis as unknown as {
                window: { dispatchEvent(event: unknown): void };
                Event: new (type: string) => unknown;
            };
            browser.window.dispatchEvent(new browser.Event('visibilitychange'));
        });
    }

    /** The dialog table's `sr-only` caption — what the table says it lists. */
    deadLettersCaption(): Locator {
        return this.deadLettersTable().locator('caption');
    }

    /**
     * The `aria-label` on every Retry button in the dialog, in row order.
     *
     * Read as attributes rather than as accessible names because the property
     * under test *is* the attribute: three buttons all reading "Retry" would
     * pass every naming rule axe has and still be useless to anyone listening
     * rather than looking.
     */
    async deadLetterRetryLabels(): Promise<string[]> {
        const buttons = this.deadLetterRetryButtons();
        const count = await buttons.count();
        const labels: string[] = [];
        for (let index = 0; index < count; index += 1) {
            labels.push(
                (await buttons.nth(index).getAttribute('aria-label')) ?? ''
            );
        }
        return labels;
    }

    /** The `scope` of each column header in the dialog's table, in order. */
    async deadLettersHeaderScopes(): Promise<(string | null)[]> {
        const heads = this.deadLettersTable().locator('thead th');
        const count = await heads.count();
        const scopes: (string | null)[] = [];
        for (let index = 0; index < count; index += 1) {
            scopes.push(await heads.nth(index).getAttribute('scope'));
        }
        return scopes;
    }

    /** Anything on the page claiming a sort state. Nothing here is sortable. */
    sortedCells(): Locator {
        return this.page.locator('[aria-sort]');
    }

    /** Whether focus currently sits inside the open dialog. */
    async focusIsInsideDialog(): Promise<boolean> {
        return this.page.evaluate(() => {
            const { document } = globalThis as unknown as {
                document: {
                    activeElement: unknown;
                    querySelector(
                        selector: string
                    ): { contains(node: unknown): boolean } | null;
                };
            };
            return (
                document
                    .querySelector('[role="dialog"]')
                    ?.contains(document.activeElement) ?? false
            );
        });
    }

    /** The id of whatever holds focus right now (`''` if it has none). */
    async focusedElementId(): Promise<string> {
        return this.page.evaluate(() => {
            const { document } = globalThis as unknown as {
                document: { activeElement: { id?: string } | null };
            };
            return document.activeElement?.id ?? '';
        });
    }

    /** A toast by its text — the retry's only announcement. */
    toast(text: string | RegExp): Locator {
        return this.page
            .locator('[data-sonner-toast]')
            .filter({ hasText: text });
    }

    /**
     * The Action-column labels currently on screen. Every one should be a
     * localized phrase — a value containing a `.` is a raw wire kind that fell
     * through `formatActivityAction`'s fallback.
     */
    async actionLabels(): Promise<string[]> {
        return this.page
            .locator('table tbody tr td:nth-child(4)')
            .allInnerTexts();
    }

    /** The Subject-column type labels currently on screen (the first line). */
    async subjectTypeLabels(): Promise<string[]> {
        const cells = await this.page
            .locator('table tbody tr td:nth-child(5)')
            .allInnerTexts();
        return cells.map((cell) => cell.split('\n')[0].trim());
    }
}
