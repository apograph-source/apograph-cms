import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import type { BrowserGlobals } from '../browserGlobals';

/**
 * Page object for the webhooks pages (from `@orthacms/webhooks-admin`) — the
 * global directory surface that configures where this CMS posts when content
 * changes, and shows whether it arrived.
 *
 * Data comes from the `**\/api/webhooks**` mocks (`mockWebhooksApi`); the
 * editor's workspace picker reads `GET /api/workspaces` (`mockWorkspaces`).
 * Tests also need `mockSignedIn` for the shell's auth probe. Both pages gate on
 * `webhooks:read`, and every write control on `webhooks:manage` — unlike most
 * surfaces here, **both are administrator-only**, so withholding `webhooks:read`
 * is how a spec reaches the no-access state.
 */
export class WebhooksPage extends BasePage {
    /** The list page's `<h1>`. */
    readonly heading: Locator;
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The Webhooks entry in the primary nav. */
    readonly navLink: Locator;
    /** The endpoint table, named by its `sr-only` caption. */
    readonly table: Locator;
    /** The header action that opens the create dialog. */
    readonly newWebhookButton: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Webhooks',
            level: 1
        });
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.navLink = this.nav.getByRole('link', { name: 'Webhooks' });
        this.table = page.getByRole('table', {
            name: 'Configured webhook endpoints'
        });
        this.newWebhookButton = page.getByRole('button', {
            name: 'New webhook'
        });
    }

    async goto() {
        await this.page.goto('/webhooks');
    }

    /** Open one endpoint's detail page. */
    async gotoDetail(id: string) {
        await this.page.goto(`/webhooks/${id}`);
    }

    // --- list --------------------------------------------------------------

    /** One endpoint's row, found by its name. */
    row(name: string): Locator {
        return this.table.getByRole('row').filter({ hasText: name });
    }

    /** The list-failed alert — must never be the empty state. */
    errorAlert(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'Couldn’t load webhooks' });
    }

    /** The empty state's heading. */
    emptyHeading(): Locator {
        return this.page.getByRole('heading', { name: 'No webhooks yet' });
    }

    /** The no-access state's heading. */
    noAccessHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'You don’t have access to webhooks'
        });
    }

    // --- the editor page ---------------------------------------------------

    /**
     * The editor is a **page**, not a dialog (`/webhooks/new`,
     * `/webhooks/:id/edit`), so its controls are scoped to the page rather than
     * to a modal. `dialog()` below is the reveal-once secret and the delivery
     * sheet, which are still modals.
     */
    editorHeading(name: 'New webhook' | 'Edit webhook'): Locator {
        return this.page.getByRole('heading', { name, level: 1 });
    }

    /** Opens the create form directly. */
    async gotoNew() {
        await this.page.goto('/webhooks/new');
    }

    /** Opens one endpoint's edit form directly. */
    async gotoEdit(id: string) {
        await this.page.goto(`/webhooks/${id}/edit`);
    }

    /** A refusal the server wrote, shown in the form rather than as a toast. */
    formError(text: string | RegExp): Locator {
        return this.page.getByRole('alert').filter({ hasText: text });
    }

    /** The reveal-once secret dialog and the delivery sheet. */
    dialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /** The editor's name field. */
    nameField(): Locator {
        return this.page.getByLabel('Name');
    }

    /** The editor's URL field. */
    urlField(): Locator {
        return this.page.getByLabel('URL');
    }

    /** The "All workspaces" toggle — the difference between "all" and "none". */
    allWorkspacesToggle(): Locator {
        return this.page.getByRole('checkbox', { name: /All workspaces/ });
    }

    /** The "Every event" toggle. */
    allEventsToggle(): Locator {
        return this.page.getByRole('checkbox', { name: /Every event/ });
    }

    /** The workspace picker, which only exists once "All workspaces" is off. */
    workspacesPicker(): Locator {
        return this.page.getByRole('combobox', { name: 'Workspaces' });
    }

    /** Chooses one workspace by name and closes the popover. */
    async chooseWorkspace(name: string) {
        await this.workspacesPicker().click();
        await this.page.getByRole('option', { name }).click();
        await this.page.keyboard.press('Escape');
    }

    /**
     * The line shown in place of the type controls before any workspace is
     * chosen — which types exist is a question about the workspaces.
     */
    contentTypesGateHint(): Locator {
        return this.page.getByText(/Choose a workspace first/);
    }

    /** The line shown when the chosen workspaces were granted no types. */
    noGrantsHint(): Locator {
        return this.page.getByText(/granted no content types/);
    }

    /** The "Every content type" toggle. */
    allContentTypesToggle(): Locator {
        return this.page.getByRole('checkbox', {
            name: /Every content type/
        });
    }

    /** The content-type picker, which only exists once that toggle is off. */
    contentTypesPicker(): Locator {
        return this.page.getByRole('combobox', { name: 'Content types' });
    }

    /**
     * The type picker's search box, which doubles as the way in for a name the
     * registry has no row for.
     */
    contentTypeSearchBox(): Locator {
        return this.page.getByPlaceholder('Search, or type a machine name');
    }

    /** The picker's "Add …" row, offered for a name that is not an option. */
    addContentTypeOption(name: string): Locator {
        return this.page.getByRole('option', { name: `Add “${name}”` });
    }

    /** Types a name into the type picker and takes its add row. */
    async addContentTypeByName(name: string) {
        await this.contentTypeSearchBox().fill(name);
        await this.addContentTypeOption(name).click();
    }

    /** A selected filter value, as the picker's trigger shows it. */
    pickedValue(label: string): Locator {
        return this.page.getByText(label, { exact: true });
    }

    /** The status switch — enabled or not. */
    enabledSwitch(): Locator {
        return this.page.getByRole('switch');
    }

    /** The confirm shown when the switch is turned off. */
    disableConfirm(): Locator {
        return this.page
            .getByRole('dialog')
            .filter({ hasText: 'Turn this endpoint off?' });
    }

    /** That confirm's decline button. */
    keepEnabledButton(): Locator {
        return this.disableConfirm().getByRole('button', {
            name: 'Keep it on'
        });
    }

    /** That confirm's accept button. */
    disableConfirmButton(): Locator {
        return this.disableConfirm().getByRole('button', {
            name: 'Turn it off'
        });
    }

    /** The "Add header" button in the custom-headers editor. */
    addHeaderButton(): Locator {
        return this.page.getByRole('button', { name: 'Add header' });
    }

    /** The nth header row's name field (0-based). */
    headerNameField(index = 0): Locator {
        return this.page.getByLabel('Header name').nth(index);
    }

    /** The nth header row's value field (0-based). */
    headerValueField(index = 0): Locator {
        return this.page.getByLabel('Header value').nth(index);
    }

    /** The refusal shown beside a header name the delivery owns. */
    headerError(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: /reserved for the delivery/ });
    }

    /** The editor's submit button when creating. */
    submitButton(): Locator {
        return this.page.getByRole('button', { name: 'Create webhook' });
    }

    // --- the one-time secret ------------------------------------------------

    /** The reveal dialog's read-only secret field. */
    secretField(): Locator {
        return this.page.getByLabel('Webhook signing secret');
    }

    /** The reveal dialog's copy button. */
    copySecretButton(): Locator {
        return this.page.getByRole('button', { name: 'Copy' });
    }

    // --- the detail page ----------------------------------------------------

    /** The delivery log's table. */
    deliveriesTable(): Locator {
        return this.page.getByRole('table', { name: 'Delivery log' });
    }

    /** The detail page's Edit action, which opens the editor on this endpoint. */
    editButton(): Locator {
        return this.page.getByRole('button', { name: 'Edit' });
    }

    /** The editor's submit button when editing rather than creating. */
    saveButton(): Locator {
        return this.page.getByRole('button', { name: 'Save', exact: true });
    }

    /** The Settings tab trigger. */
    settingsTab(): Locator {
        return this.page.getByRole('tab', { name: 'Settings' });
    }

    /** The Deliveries tab trigger. */
    deliveriesTab(): Locator {
        return this.page.getByRole('tab', { name: 'Deliveries' });
    }

    /** The auto-disabled banner on the detail page. */
    autoDisabledAlert(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'Disabled automatically' });
    }

    /** The "View" action on the first delivery row. */
    firstDeliveryViewButton(): Locator {
        return this.page.getByRole('button', { name: 'View' }).first();
    }

    /** The delivery detail sheet. */
    deliverySheet(): Locator {
        return this.page.getByRole('dialog');
    }

    /** The delivery log's state filter — named explicitly, not by its value. */
    stateFilter(): Locator {
        return this.page.getByRole('combobox', { name: 'Filter by state' });
    }

    /** The event picker's option list, once the picker is open. */
    eventOption(label: string): Locator {
        return this.page.getByRole('option', { name: label });
    }

    /** Opens the event picker, which only exists once "Every event" is off. */
    async openEventPicker() {
        await this.allEventsToggle().click();
        // By name, not by position: the form holds three pickers, and which one
        // is last depends on which "All …" toggles are off.
        await this.page.getByRole('combobox', { name: 'Events' }).click();
    }

    /**
     * Opens the content-type picker, which only exists once "Every content
     * type" is off.
     */
    async openContentTypePicker() {
        await this.allContentTypesToggle().click();
        await this.contentTypesPicker().click();
    }

    /** The reveal dialog's "you haven't copied it" guard. */
    uncopiedWarning(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'haven’t copied' });
    }

    /** The secret hint shown on the Settings tab, e.g. "Ends in a1b2". */
    secretHint(hint: string): Locator {
        return this.page.getByText(`Ends in ${hint}`);
    }

    /** Any occurrence of `text` on the page — for proving a secret is absent. */
    anyText(text: string): Locator {
        return this.page.getByText(text);
    }

    /**
     * Whether the page itself scrolls sideways, and whether the table's own
     * wrapper takes the overflow instead (WCAG 1.4.10).
     *
     * Geometry, not a rule engine — axe cannot answer this, and it is exactly
     * what a wide table gets wrong.
     */
    async reflowGeometry() {
        return this.page.evaluate(() => {
            const { document, window, getComputedStyle } =
                globalThis as unknown as BrowserGlobals;
            const table = document.querySelector('table');
            const wrapper = table?.parentElement ?? null;
            return {
                overflowX: wrapper
                    ? getComputedStyle(wrapper).overflowX
                    : 'none',
                wrapperScrolls: wrapper
                    ? wrapper.scrollWidth > wrapper.clientWidth
                    : false,
                pageScrollsSideways:
                    document.documentElement.scrollWidth > window.innerWidth
            };
        });
    }
}
