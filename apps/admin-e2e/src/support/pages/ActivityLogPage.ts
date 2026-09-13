import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Activity Log at `/activity` (from
 * `@apograph/activity-admin`).
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
