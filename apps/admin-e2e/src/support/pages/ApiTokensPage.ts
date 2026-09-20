import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import type { BrowserGlobals } from '../browserGlobals';

/**
 * Page object for the API tokens page at `/api-tokens` (from
 * `@orthacms/api-tokens-admin`) — the global directory page that lists, mints
 * and revokes the bearer tokens for the external content API.
 *
 * Data comes from the `**\/api/api-tokens**` mock (`mockApiTokensApi`); the
 * workspace selector and the table's bucket column read `GET /api/workspaces`
 * (`mockWorkspaces`). Tests also need `mockSignedIn` for the shell's auth
 * probe. The page gates on `tokens:read`, and the create/revoke controls on
 * `tokens:create` / `tokens:delete`.
 */
export class ApiTokensPage extends BasePage {
    /** The page's `<h1>`. */
    readonly heading: Locator;
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The API Tokens entry in the primary nav. */
    readonly navLink: Locator;
    /** The tokens table, named by its `aria-label`. */
    readonly table: Locator;
    /** The header action that opens the create dialog. */
    readonly newTokenButton: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'API tokens',
            level: 1
        });
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.navLink = this.nav.getByRole('link', { name: 'API Tokens' });
        this.table = page.getByRole('table', { name: 'API tokens' });
        this.newTokenButton = page.getByRole('button', { name: 'New token' });
    }

    async goto() {
        await this.page.goto('/api-tokens');
    }

    /** Open the page with a query string, for the `?page=` deep-link cases. */
    async gotoWith(search: string) {
        await this.page.goto(`/api-tokens?${search}`);
    }

    // --- list states -------------------------------------------------------

    /** The `sr-only` live region carrying the result count (WCAG 4.1.3). */
    resultsStatus(): Locator {
        return this.page.getByRole('status').filter({ hasText: /API token/ });
    }

    /** The list-failed alert — must never be the empty state. */
    errorAlert(): Locator {
        return this.page.getByRole('alert').filter({
            hasText: 'Couldn’t load API tokens'
        });
    }

    /** The retry action inside the list-failed alert. */
    retryButton(): Locator {
        return this.errorAlert().getByRole('button', { name: 'Retry' });
    }

    /** The empty state's heading. */
    emptyHeading(): Locator {
        return this.page.getByRole('heading', { name: 'No API tokens yet' });
    }

    /** The empty state's create action (gated on `tokens:create`). */
    emptyCreateButton(): Locator {
        return this.page.getByRole('button', { name: 'New token' }).last();
    }

    /** The no-access state's heading (shown without `tokens:read`). */
    noAccessHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'You don’t have access to API tokens'
        });
    }

    /** The loading skeleton's `role="status"` region. */
    skeleton(): Locator {
        return this.page.getByRole('status').filter({
            hasText: 'Loading API tokens'
        });
    }

    /**
     * Every column header the **loaded** table renders. Scoped to `table`, which
     * is the only one carrying the `aria-label`: the loading skeleton draws its
     * own eight-column table regardless of permissions, so a column-count
     * assertion has to be made against the loaded table or it proves nothing.
     */
    columnHeaders(): Locator {
        return this.table.getByRole('columnheader');
    }

    /**
     * The actions column's header, named by the `sr-only` text inside it. It
     * ships only with `tokens:delete` — a header cell left behind for a column
     * that renders no controls would offset every row's cells from their
     * headers for a screen-reader user.
     */
    actionsColumnHeader(): Locator {
        return this.table.getByRole('columnheader', { name: 'Actions' });
    }

    // --- rows --------------------------------------------------------------

    /** A table row located by the token name it carries. */
    row(name: string): Locator {
        return this.table.getByRole('row').filter({ hasText: name });
    }

    /** The Status cell's badge text for a named token. */
    rowStatus(name: string): Locator {
        return this.row(name).getByRole('cell').nth(4);
    }

    /** The Workspaces cell for a named token (one badge per workspace). */
    rowWorkspaces(name: string): Locator {
        return this.row(name).getByRole('cell').nth(1);
    }

    /** The row's kebab — rendered only for an `active` token. */
    rowActions(name: string): Locator {
        return this.row(name).getByRole('button', {
            name: `Actions for ${name}`
        });
    }

    /** Open a row's kebab and pick Revoke, landing on the confirm dialog. */
    async chooseRevoke(name: string) {
        await this.rowActions(name).click();
        await this.page.getByRole('menuitem', { name: 'Revoke' }).click();
        await this.confirmDialog().waitFor();
    }

    // --- pager -------------------------------------------------------------

    /** The "Page n of m" indicator (absent when there is only one page). */
    pageIndicator(): Locator {
        return this.page.getByText(/^Page \d+ of \d+$/);
    }

    previousButton(): Locator {
        return this.page.getByRole('button', { name: 'Previous' });
    }

    nextButton(): Locator {
        return this.page.getByRole('button', { name: 'Next' });
    }

    // --- create dialog -----------------------------------------------------

    createDialog(): Locator {
        return this.page.getByRole('dialog', { name: 'New API token' });
    }

    nameField(): Locator {
        return this.createDialog().getByLabel('Name');
    }

    workspacesSelect(): Locator {
        return this.createDialog().getByRole('combobox', {
            name: 'Workspaces'
        });
    }

    /** The Access select — named, so it can be told from Expires. */
    accessSelect(): Locator {
        return this.createDialog().getByRole('combobox', { name: 'Access' });
    }

    /** The Expires select — named, so it can be told from Access. */
    expiresSelect(): Locator {
        return this.createDialog().getByRole('combobox', { name: 'Expires' });
    }

    submitCreateButton(): Locator {
        return this.createDialog().getByRole('button', {
            name: 'Create token'
        });
    }

    cancelCreateButton(): Locator {
        return this.createDialog().getByRole('button', { name: 'Cancel' });
    }

    /** The selector's "couldn't load the workspaces" alert. */
    workspacesError(): Locator {
        return this.createDialog()
            .getByRole('alert')
            .filter({ hasText: 'Couldn’t load the workspaces' });
    }

    /** The retry action inside the selector's alert. */
    workspacesRetryButton(): Locator {
        return this.workspacesError().getByRole('button', { name: 'Retry' });
    }

    /** Open the create dialog and wait for it. */
    async openCreate() {
        await this.newTokenButton.click();
        await this.createDialog().waitFor();
    }

    /** One option row inside the workspace selector's popover. */
    workspaceOption(name: string): Locator {
        return this.page.getByRole('option', { name, exact: true });
    }

    /**
     * The selector's "nothing to pick" line, rendered inside the open popover.
     * The counterpart to {@link workspacesError}: it means the list arrived and
     * was empty, which is a different problem from not being able to ask.
     */
    workspacesEmpty(): Locator {
        return this.page.getByText('No workspaces found.');
    }

    /** Open the workspace selector's popover and leave it open. */
    async openWorkspacePopover() {
        await this.workspacesSelect().click();
        await this.page.getByRole('listbox').waitFor();
    }

    /** Tick a workspace in the `MultiSelect`, then close its popover. */
    async pickWorkspace(name: string) {
        await this.workspacesSelect().click();
        await this.workspaceOption(name).click();
        await this.page.keyboard.press('Escape');
    }

    /** Choose an option in an open Radix `Select`. */
    async chooseOption(label: string) {
        await this.page.getByRole('option', { name: label }).click();
    }

    /** Fill the minimum a token needs and submit. */
    async createToken(name: string, workspace = 'Marketing site') {
        await this.openCreate();
        await this.nameField().fill(name);
        await this.pickWorkspace(workspace);
        await this.submitCreateButton().click();
    }

    // --- reveal dialog -----------------------------------------------------

    revealDialog(): Locator {
        return this.page.getByRole('dialog', { name: 'Copy your API token' });
    }

    /**
     * The one-time secret. A labelled, focusable `readOnly` input — not a bare
     * `<code>` — so a keyboard or screen-reader user can read and copy it
     * without the Copy button, which is the only fallback when the clipboard
     * write is refused.
     */
    secretField(): Locator {
        return this.revealDialog().getByRole('textbox', {
            name: 'API token secret'
        });
    }

    copyButton(): Locator {
        return this.revealDialog().getByRole('button', { name: 'Copy' });
    }

    doneButton(): Locator {
        return this.revealDialog().getByRole('button', { name: 'Done' });
    }

    /** The "you haven't copied it yet" guard raised by a bare dismissal. */
    uncopiedWarning(): Locator {
        return this.revealDialog()
            .getByRole('alert')
            .filter({ hasText: 'You haven’t copied the token yet' });
    }

    keepOpenButton(): Locator {
        return this.revealDialog().getByRole('button', {
            name: 'Keep it open'
        });
    }

    closeWithoutCopyingButton(): Locator {
        return this.revealDialog().getByRole('button', {
            name: 'Close without copying'
        });
    }

    /**
     * The reveal dialog's corner X. `exact` matters: "Close without copying"
     * carries "Close" too, and a substring match would resolve to whichever of
     * the two is on screen — including the very button this dialog is only
     * supposed to offer *after* the guard.
     */
    revealCloseButton(): Locator {
        return this.revealDialog().getByRole('button', {
            name: 'Close',
            exact: true
        });
    }

    // --- revoke confirm ----------------------------------------------------

    confirmDialog(): Locator {
        return this.page.getByRole('dialog', { name: 'Revoke this token?' });
    }

    confirmRevokeButton(): Locator {
        return this.confirmDialog().getByRole('button', { name: 'Revoke' });
    }

    cancelRevokeButton(): Locator {
        return this.confirmDialog().getByRole('button', { name: 'Cancel' });
    }

    // --- toasts ------------------------------------------------------------

    /** A sonner toast by its message text (the shell's single live region). */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    // --- browser plumbing --------------------------------------------------

    /**
     * The modal backdrop behind whichever dialog is open. Radix renders it as
     * decoration — no role, no name — so it is located by shape, the way
     * `ContentLibraryPage.propertiesScrim` is. Filtered on `data-state="open"`
     * so a dialog still playing its exit animation is never the match.
     */
    dialogBackdrop(): Locator {
        return this.page.locator('div.fixed.inset-0.z-50[data-state="open"]');
    }

    /**
     * Dismiss by clicking the backdrop — the pointer equivalent of Escape, and
     * the easiest one to reach by accident. Aimed at the top-left corner rather
     * than the element's centre, which the dialog panel itself covers.
     */
    async clickBackdrop() {
        await this.dialogBackdrop().click({ position: { x: 5, y: 5 } });
    }

    /**
     * Make `navigator.clipboard.writeText` reject, the way an insecure origin,
     * a denied permission or an unfocused document does. Install before the app
     * loads, so the dialog's handler sees the stub.
     */
    async denyClipboard() {
        await this.page.addInitScript(() => {
            const { navigator } = globalThis as unknown as BrowserGlobals;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: () =>
                        Promise.reject(new Error('clipboard denied'))
                }
            });
        });
    }

    /** Whatever currently holds focus, as `TAG` plus its accessible-ish name. */
    async focusedDescription(): Promise<string> {
        return this.page.evaluate(() => {
            const { document } = globalThis as unknown as BrowserGlobals;
            const active = document.activeElement;
            if (!active || active === document.body) {
                return 'BODY';
            }
            const name =
                active.getAttribute('aria-label') ??
                active.textContent?.trim().slice(0, 40) ??
                '';
            return `${active.tagName}:${name}`;
        });
    }
}
