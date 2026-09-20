import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Members page at `/users` (from `@orthacms/users-admin`).
 *
 * Data comes from the `GET /api/users` mock (`mockMembers`); tests also need
 * `mockSignedIn` for the auth probe, since the page lives behind the shell's
 * gate. Permission-gated controls assume the signed-in user's `permissions`
 * (set via `mockSignedIn`).
 */
export class MembersPage extends BasePage {
    /** The page's `<h1>`. */
    readonly heading: Locator;
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The search box (leading search icon). */
    readonly search: Locator;
    /** The header's primary "Invite member" button. */
    readonly inviteButton: Locator;

    constructor(page: Page) {
        super(page);
        // `exact`, because the route's `Suspense` fallback now carries an
        // `<h1>` of its own ("Loading members" — `ORT-167`), and Playwright's
        // default name matching is a case-insensitive **substring**. Without it
        // this resolved during the skeleton, before the page had even issued its
        // list request, and every spec that waited on it was racing the load.
        this.heading = page.getByRole('heading', {
            name: 'Members',
            exact: true,
            level: 1
        });
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.search = page.getByRole('searchbox', {
            name: 'Search members by name or email'
        });
        this.inviteButton = page.getByRole('button', {
            name: 'Invite member'
        });
    }

    async goto() {
        await this.page.goto('/users');
    }

    /** A member's row, located by the member's visible name or email text. */
    row(nameOrEmail: string): Locator {
        return this.page.getByRole('row').filter({ hasText: nameOrEmail });
    }

    /**
     * The table loading skeleton — a `role="status"` region announcing
     * "Loading members…", shown while the list query is in flight (seed it with
     * `mockMembers(page, …, { delayMs })`).
     */
    tableSkeleton(): Locator {
        return this.page
            .getByRole('status')
            .filter({ hasText: /Loading members/ });
    }

    /** A status pill anywhere in the table (e.g. "Invited"). */
    statusPill(label: string): Locator {
        return this.page.getByText(label, { exact: true });
    }

    /** A primary-nav entry by label — rendered only for the permission it declares. */
    navItem(label: string): Locator {
        return this.nav.getByRole('link', { name: label });
    }

    /**
     * The list's retryable failure — an alert in place of the table, not an
     * empty table. `role="alert"` is unique on this page (the toolbar and
     * pagination carry none), so the bare role is a safe anchor.
     */
    errorAlert(): Locator {
        return this.page.getByRole('alert');
    }

    /** The error alert's own Retry, which refetches without a reload. */
    retryButton(): Locator {
        return this.errorAlert().getByRole('button', { name: 'Retry' });
    }

    /**
     * The result area's empty state. Both empties render through it — the
     * search miss and the genuinely empty roster — so scoping here is what
     * separates its "Invite member" button from the header's, which carries the
     * identical accessible name and would otherwise be a second match.
     */
    emptyState(): Locator {
        return this.page.locator('[data-slot="empty"]');
    }

    /** The empty roster's call to action (absent without `users:create`). */
    emptyInviteButton(): Locator {
        return this.emptyState().getByRole('button', {
            name: 'Invite member'
        });
    }

    /** The search miss's way back to the full roster. */
    clearSearchButton(): Locator {
        return this.emptyState().getByRole('button', { name: 'Clear search' });
    }

    /**
     * The polite live region that restates how many members matched. A `<p>`,
     * unlike the loading skeleton's `role="status"` `<div>`, and matched on the
     * sentence it always ends with so a live region elsewhere in the shell (the
     * copilot dock composer's) can never be picked up instead.
     */
    resultsStatus(): Locator {
        return this.page
            .locator('p[role="status"]')
            .filter({ hasText: /members? found\./ });
    }

    /**
     * The tooltip a guarded row action opens. Radix draws the bubble and, for
     * assistive tech, a `role="tooltip"` copy of the same text — so this handle
     * is the one that proves the reason reached both.
     */
    actionTooltip(): Locator {
        return this.page.getByRole('tooltip');
    }

    /**
     * A sonner toast by its text. The shell keeps one live region for the whole
     * app, so a row action's failure notice lands here rather than anywhere near
     * the row it came from.
     */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    /** The kebab actions trigger in a member's row. */
    actionsTrigger(name: string): Locator {
        return this.page.getByRole('button', { name: `Actions for ${name}` });
    }

    /** Open a member's row menu. */
    async openActions(name: string) {
        await this.actionsTrigger(name).click();
    }

    /** A menu item by its label (rendered in the portaled menu). */
    menuItem(label: string): Locator {
        return this.page.getByRole('menuitem', { name: label });
    }

    /** The read-only role chip in a member's row. */
    roleChip(name: string): Locator {
        return this.row(name).getByText(/^(Admin|Contributor|Viewer)$/);
    }

    // --- the destructive-action confirmation ---

    /**
     * The confirm dialog a destructive row action opens. Both Disable and
     * Revoke invite go through one — neither fires straight off the menu.
     */
    confirmDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /** The confirm dialog's title, which must name what is about to happen. */
    confirmTitle(name: string): Locator {
        return this.page.getByRole('heading', { name });
    }

    /** A button inside the confirm dialog, by label. */
    confirmAction(label: string): Locator {
        return this.confirmDialog().getByRole('button', { name: label });
    }

    /**
     * The roster's focus anchor — where focus lands after a row is removed. It
     * wraps every result state, so it survives the table being swapped for the
     * empty state when the last row goes.
     */
    resultsAnchor(): Locator {
        return this.page.locator('#members-results');
    }

    // --- invite wizard (/users/invite) ---

    inviteHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'Invite a member',
            level: 1
        });
    }

    inviteEmail(): Locator {
        return this.page.getByLabel('Email');
    }

    continueToRole(): Locator {
        return this.page.getByRole('button', { name: 'Continue to role' });
    }

    continueToWorkspaces(): Locator {
        return this.page.getByRole('button', {
            name: 'Continue to workspaces'
        });
    }

    inviteRole(label: string): Locator {
        return this.page.getByRole('radio', { name: label });
    }

    /** A workspace checkbox in the assignment step, by its visible name. */
    inviteWorkspace(name: string): Locator {
        return this.page.getByRole('checkbox', { name });
    }

    /** A workspace-access mode tile ("All workspaces" / "Specific workspaces"). */
    inviteWorkspaceMode(label: string): Locator {
        return this.page.getByRole('radio', { name: label });
    }

    /** The search box in the assignment step (shown in "Specific" mode). */
    workspaceSearch(): Locator {
        return this.page.getByLabel('Search workspaces');
    }

    sendInvite(): Locator {
        return this.page.getByRole('button', { name: 'Send invite' });
    }

    // --- the invite link hand-off (wizard success step + resend dialog) ---

    /**
     * The wizard's success heading, shown in place of the form once the invite
     * exists. The wizard deliberately does **not** redirect: the raw token comes
     * back once, so leaving the page before copying it means resending.
     */
    inviteSentHeading(): Locator {
        return this.page.getByRole('heading', {
            name: /^Invite created for/
        });
    }

    /**
     * The read-only field holding the shareable invite link. Scoped by its
     * accessible name so it works in both places the panel appears — the
     * wizard's success step and the resend dialog.
     */
    inviteLinkField(email: string): Locator {
        return this.page.getByRole('textbox', {
            name: `Invite link for ${email}`
        });
    }

    /** The panel's copy-to-clipboard control. */
    copyInviteLink(): Locator {
        return this.page.getByRole('button', { name: 'Copy link' });
    }

    /** The dialog a resend opens, carrying the rotated link. */
    inviteLinkDialog(): Locator {
        return this.page.getByRole('dialog').filter({
            hasText: /Send this link to/
        });
    }

    // --- detail navigation ---

    /** A member's name rendered as a link to their detail page. */
    memberLink(name: string): Locator {
        return this.page.getByRole('link', { name });
    }

    /** Open a member's detail page by clicking their name link. */
    async openMember(name: string) {
        await this.memberLink(name).click();
    }

    // --- pagination ---

    /** The "{from}–{to} of {total}" readout in the pagination bar. */
    paginationRange(): Locator {
        return this.page.getByText(/^\d+.\d+ of \d+$/);
    }

    /**
     * The "Page {n} of {count}" readout between the prev/next controls, shown
     * only once there is more than one page. The clamp's visible effect, so it
     * is what a resilience test reads rather than the row range.
     */
    pageReadout(): Locator {
        return this.page.getByText(/^Page \d+ of \d+$/);
    }

    /** Pick a rows-per-page value from the page-size select. */
    async setRowsPerPage(value: string) {
        await this.page
            .getByRole('combobox', { name: 'Rows per page' })
            .click();
        await this.page
            .getByRole('option', { name: value, exact: true })
            .click();
    }

    nextPage(): Locator {
        return this.page.getByRole('button', { name: 'Next page' });
    }

    prevPage(): Locator {
        return this.page.getByRole('button', { name: 'Previous page' });
    }

    // The query-builder filter-drawer helpers live on BasePage (the drawer is
    // the same component on every list page).

    // --- empty / no-access states ---

    noAccessText(): Locator {
        return this.page.getByText('You don’t have access to members');
    }

    emptyText(text: string): Locator {
        return this.page.getByText(text);
    }
}
