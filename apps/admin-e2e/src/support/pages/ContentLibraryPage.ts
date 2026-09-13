import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { type BrowserGlobals } from '../browserGlobals';

/**
 * Page object for the Content Library at `/workspaces/:id/content` (from
 * `@apograph/content-admin`) — the second-sidebar nav (collapsible Collections
 * and Pages groups, a Favorites section), the ⌘K search palette, and the
 * selected-type pane. Seed it with
 * `mockSignedIn`, `mockWorkspaces`, and `mockContentSchema`.
 */
export class ContentLibraryPage extends BasePage {
    /** The second sidebar nav region. */
    readonly sidebar: Locator;
    /**
     * The content library's own second-sidebar search trigger (opens its
     * collections/pages palette). Distinct from the global shell command palette
     * (`BasePage.searchTrigger()`), so it carries its own name.
     */
    readonly contentSearchTrigger: Locator;
    /** The command palette dialog. */
    readonly searchDialog: Locator;
    /** The palette's search input. */
    readonly searchInput: Locator;

    constructor(page: Page) {
        super(page);
        this.sidebar = page.getByRole('navigation', { name: 'Content types' });
        this.contentSearchTrigger = this.sidebar.getByRole('button', {
            name: /Search/
        });
        this.searchDialog = page.getByRole('dialog');
        this.searchInput = page.getByPlaceholder(
            'Search collections and pages…'
        );
    }

    /** Navigate straight to a workspace's Content Library. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/content`);
    }

    /** Navigate straight to one entry's editor (`/content/:type/:id`). */
    async gotoEntry(workspaceId: string, typeName: string, id: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/content/${typeName}/${id}`
        );
    }

    /** An entry-editor tab trigger by label ("General" / "History"). */
    editorTab(name: string): Locator {
        return this.page.getByRole('tab', { name });
    }

    /** Open one entry-editor tab. */
    async openEditorTab(name: string) {
        await this.editorTab(name).click();
    }

    /**
     * The active editor tabpanel — the History tab renders the full revision
     * timeline (the sidebar widget shows a compact copy, so scope revision
     * assertions to this panel to avoid matching both).
     */
    get editorTabPanel(): Locator {
        return this.page.getByRole('tabpanel');
    }

    /** The History timeline's `<li>` for version `n` (scoped to the tab panel). */
    revisionItem(n: number): Locator {
        return this.editorTabPanel
            .getByRole('listitem')
            .filter({ has: this.page.getByText(`v${n}`, { exact: true }) });
    }

    /** Every "Live" status badge in the History timeline. */
    get liveRevisionBadges(): Locator {
        return this.editorTabPanel.getByText('Live', { exact: true });
    }

    /** The History-row "Publish version {n}" action (scoped to the tab panel). */
    revisionPublish(n: number): Locator {
        return this.editorTabPanel.getByRole('button', {
            name: `Publish version ${n}`
        });
    }

    /**
     * The History-row "Preview version {n}" action (scoped to the tab panel).
     *
     * Scoped for the reason the panel getter above gives: the right-rail widget
     * renders a compact copy of the same timeline, so an unscoped name matches
     * both rows and the click fails on strict mode rather than on the product.
     */
    revisionPreview(n: number): Locator {
        return this.editorTabPanel.getByRole('button', {
            name: `Preview version ${n}`
        });
    }

    /** The confirm button inside the publish-version confirmation dialog. */
    get confirmPublishButton(): Locator {
        return this.page
            .getByRole('dialog')
            .getByRole('button', { name: 'Publish', exact: true });
    }

    /** Publish revision `n` from the History timeline (row action + confirm). */
    async publishRevision(n: number) {
        await this.revisionPublish(n).click();
        await this.confirmPublishButton.click();
    }

    /**
     * The relation-id value editor — a record picker rather than a raw uuid
     * input. It is the rule's **third** combobox (field, operator, value); like
     * the other two its trigger is `role="combobox"`, not a plain button.
     */
    async openRelationValuePicker() {
        await this.filterSurface().getByRole('combobox').nth(2).click();
    }

    /** Toggle one record in the open relation value picker, by its title. */
    async pickRelationRecord(title: string) {
        await this.page
            .getByRole('option', { name: title, exact: true })
            .click();
    }

    /** A collapsible group trigger by label ("Collections" / "Pages"). */
    group(label: string): Locator {
        return this.sidebar.getByRole('button', {
            name: new RegExp(`^${label}`)
        });
    }

    /**
     * Expand a collapsible group, **idempotently**. The Collections group is
     * open by default (and the group holding a deep-linked type auto-opens), so
     * a bare click would *collapse* an already-open group. Read `aria-expanded`
     * and only click when it's collapsed, then wait until it has settled open so
     * the caller can interact with its rows.
     */
    async expandGroup(label: string) {
        const trigger = this.group(label);
        await trigger.waitFor();
        if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
            await trigger.click();
        }
        await this.group(label)
            .and(this.page.locator('[aria-expanded="true"]'))
            .waitFor();
    }

    /**
     * A group's row when it holds nothing — a plain label, not a trigger.
     *
     * Paired with `group(label)` having no match at all: an empty group renders
     * no button, so the two together say "still listed, no longer operable".
     */
    emptyGroup(label: string): Locator {
        return this.sidebar.getByText(label, { exact: true });
    }

    /** A category label in the sidebar ("Favorites" / "Workspace Content"). */
    sectionLabel(label: string): Locator {
        return this.sidebar.getByText(label, { exact: true });
    }

    /** A content-type row link by its label. */
    typeLink(label: string): Locator {
        return this.sidebar.getByRole('link', { name: label, exact: true });
    }

    /** The pin / unpin toggle for a type row. */
    pinToggle(label: string, pinned = false): Locator {
        return this.sidebar.getByRole('button', {
            name: `${pinned ? 'Unpin' : 'Pin'} ${label}`
        });
    }

    /** Open the search palette via its trigger button. */
    async openSearch() {
        await this.contentSearchTrigger.click();
        await this.searchDialog.waitFor();
    }

    /** Open the search palette via the Ctrl/⌘+K shortcut. */
    async openSearchByShortcut() {
        // Give the page DOM focus first (just-loaded viewports aren't focused,
        // so a bare keypress wouldn't reach the window-level shortcut listener).
        // Focusing the trigger doesn't open the palette — only the shortcut does.
        await this.contentSearchTrigger.focus();
        await this.page.keyboard.press('Control+k');
        await this.searchDialog.waitFor();
    }

    /** A result option in the open palette. */
    searchOption(label: string): Locator {
        return this.searchDialog.getByRole('option', {
            name: new RegExp(label)
        });
    }

    /** The selected-type pane heading. */
    viewHeading(label: string): Locator {
        return this.page.getByRole('heading', { name: label, level: 1 });
    }

    /** The collection records table (by its `{label} records` aria-label). */
    recordsTable(label: string): Locator {
        return this.page.getByRole('table', {
            name: new RegExp(`${label} records`)
        });
    }

    /** The data rows of the records table (excludes the header row). */
    recordRows(label: string): Locator {
        return this.recordsTable(label).locator('tbody tr');
    }

    /**
     * The cells of one body column, by 1-based `<td>` position (the leading
     * selection checkbox is column 1, so the first data column is 2).
     */
    recordColumnCells(label: string, nthChild: number): Locator {
        return this.recordRows(label).locator(`td:nth-child(${nthChild})`);
    }

    /**
     * A record's own editor link — the `<Link>` wrapping the first column's
     * cell. Prefer this over clicking the row when the table has relation
     * columns: those cells `stopPropagation`, so a centred row click can land on
     * one and never navigate.
     */
    recordLink(title: string): Locator {
        return this.page.getByRole('link', { name: title, exact: true });
    }

    /** The records search box. */
    get recordsSearch(): Locator {
        return this.page.getByRole('searchbox', { name: 'Search records' });
    }

    /** The "Add record" action in the records header. */
    get addRecord(): Locator {
        return this.page.getByRole('button', { name: 'Add record' });
    }

    /** The entry editor's primary action button (label varies by type/state). */
    get editorSave(): Locator {
        return this.page.getByRole('button', {
            name: /^(Save|Save draft|Save & publish|Publish)$/
        });
    }

    /** The entry editor's "Back to records" link (present when editing a row). */
    get editorBackLink(): Locator {
        return this.page.getByRole('link', { name: 'Back to records' });
    }

    /**
     * A form field's text input by its label.
     *
     * Pass `exact` when the type has labels that are substrings of one another
     * — Playwright's `name` match is a case-insensitive **substring** by
     * default, so a "Title" field and a "Subtitle" field are two hits for
     * `'Title'` and the locator fails strict mode.
     */
    fieldTextbox(label: string, { exact = false } = {}): Locator {
        return this.page.getByRole('textbox', { name: label, exact });
    }

    /**
     * A form field's **numeric** input by its label. A `number`/`money` field
     * renders `<input type="number">`, which carries the `spinbutton` role — not
     * `textbox` — so it needs its own handle.
     */
    fieldSpinbutton(label: string): Locator {
        return this.page.getByRole('spinbutton', { name: label });
    }

    /**
     * A `date`/`datetime` field's trigger button, by the field's machine name.
     * Its text is the formatted value, so asserting on it checks what the user
     * actually reads off the control.
     */
    dateFieldTrigger(fieldName: string): Locator {
        return this.page.locator(`#entry-field-${fieldName}`);
    }

    /** A form field's `<label>` element, by the field's machine name. */
    fieldLabel(fieldName: string): Locator {
        return this.page.locator(`label[for="entry-field-${fieldName}"]`);
    }

    /** Navigate straight to a **single** (page) type's editor, which is the type
     * route itself — a page has one row, so there is no records table in front
     * of it. */
    async gotoSingle(workspaceId: string, typeName: string) {
        await this.page.goto(`/workspaces/${workspaceId}/content/${typeName}`);
    }

    /** Navigate straight to a collection's records table (`/content/:type`). */
    async gotoRecords(workspaceId: string, typeName: string) {
        await this.page.goto(`/workspaces/${workspaceId}/content/${typeName}`);
    }

    /** The banner shown over a read-only entry editor. */
    get readOnlyNotice(): Locator {
        return this.page.getByText('View only', { exact: true });
    }

    /**
     * The control carrying a field's id — a `select`'s trigger, a date field's
     * button. Located by id rather than by role because the assertion these
     * serve is about the element's *disabled* state, and a handle that resolves
     * in both states is what lets a test assert the transition instead of the
     * element simply vanishing.
     */
    fieldTrigger(fieldName: string): Locator {
        return this.page.locator(`#entry-field-${fieldName}`);
    }

    /**
     * The buttons of a `boolean` field's segmented control, scoped by the
     * `aria-labelledby` the entry form puts on the group — so two booleans on
     * one type never collide. Anchored on that rather than on a role, because
     * the design-system control is a Radix toggle group whose role mapping is
     * its own business and not something a test should encode.
     */
    booleanSegments(fieldName: string): Locator {
        return this.page
            .locator(`[aria-labelledby="entry-field-${fieldName}-label"]`)
            .locator('button');
    }

    /** The "Localized field" tooltip trigger inside a field's label row. */
    get localizedMark(): Locator {
        return this.page.getByRole('button', { name: 'Localized field' });
    }

    /** A General-tab field-group heading ("Translated fields" / "Shared fields"). */
    fieldGroupHeading(title: string): Locator {
        return this.page.getByRole('heading', { name: title, exact: true });
    }

    /**
     * The rule between the General tab's translated and shared field groups.
     *
     * Anchored on a testid rather than a role because it is **decorative** by
     * design — the design-system `Separator` renders `role="none"`, so there is
     * no accessible node to locate, and giving it one to make it testable would
     * be the bug this asserts against. Same escape hatch the widget skeletons
     * use.
     */
    get fieldGroupDivider(): Locator {
        return this.page.getByTestId('entry-field-group-divider');
    }

    /**
     * The locale-sync mark on a relation section header. Its accessible name is
     * the mode — "Shared across locales" / "Follows translations" / "This
     * locale only" — so the name is also the assertion.
     */
    relationSyncMark(mode: string): Locator {
        return this.page.getByRole('button', { name: mode });
    }

    /** The open tooltip bubble, wherever it is portalled. */
    get tooltip(): Locator {
        return this.page.getByRole('tooltip');
    }

    /** A field's inline validation message (design-system `FieldError`). */
    fieldError(message: string | RegExp): Locator {
        return this.page.getByRole('alert').filter({ hasText: message });
    }

    /** Navigate straight to a type's create form (`/content/:type/new`). */
    async gotoNewEntry(workspaceId: string, typeName: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/content/${typeName}/new`
        );
    }

    /** A toast message (sonner, portaled to the body). */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    /** Save the entry **as a draft** (the ⋯ actions menu → "Save draft"). */
    async saveDraft(): Promise<void> {
        await this.openEditorMenu();
        await this.page.getByRole('menuitem', { name: 'Save draft' }).click();
    }

    /** Open the entry editor's ⋯ actions menu (in the page top bar). */
    async openEditorMenu(): Promise<void> {
        await this.page.getByRole('button', { name: 'More actions' }).click();
    }

    /** The open ⋯ menu's items, in order — the menu must already be open. */
    get editorMenuItems(): Locator {
        return this.page.getByRole('menu').getByRole('menuitem');
    }

    /**
     * How many rules the open ⋯ menu draws. The menu is laid out in groups
     * (save / publish / extras / danger) with one separator between adjacent
     * non-empty groups, so this is the group count minus one.
     */
    get editorMenuSeparators(): Locator {
        return this.page.getByRole('menu').getByRole('separator');
    }

    /**
     * Pick an item from the open ⋯ menu by label. A string match is **exact**:
     * the menu holds both "Publish all locales" and "Unpublish all locales", and
     * Playwright's default substring match resolves the former to both.
     */
    async chooseEditorAction(label: string | RegExp): Promise<void> {
        await this.page
            .getByRole('menuitem', {
                name: label,
                exact: typeof label === 'string'
            })
            .click();
    }

    /** The publish pre-flight dialog (bulk publish, and "publish all locales"). */
    get preflightDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /**
     * One pre-flight row by the name it renders under — the record's title in
     * the records table's bulk publish, the **locale** name when the dialog is
     * listing a record's siblings.
     */
    preflightRow(name: string | RegExp): Locator {
        return this.preflightDialog
            .getByRole('listitem')
            .filter({ hasText: name });
    }

    /** The pre-flight's confirm button ("Publish {n} valid"). */
    get preflightConfirm(): Locator {
        return this.preflightDialog.getByRole('button', {
            name: /^Publish \d+ valid$/
        });
    }

    /** The "Changes saved." success toast after an edit save. */
    get savedToast(): Locator {
        return this.page.getByText('Changes saved.', { exact: true });
    }

    /** The column-picker trigger. */
    get columnsButton(): Locator {
        return this.page.getByRole('button', { name: 'Columns' });
    }

    /** A column-picker checkbox option by its label. */
    columnOption(label: string): Locator {
        return this.page.getByRole('checkbox', { name: label, exact: true });
    }

    /** The column-picker's search box. */
    get columnSearch(): Locator {
        return this.page.getByRole('textbox', { name: 'Search columns' });
    }

    /** The column-picker's "no column found" empty state. */
    get columnSearchEmpty(): Locator {
        return this.page.getByText('No column found.', { exact: true });
    }

    /** A column header cell in the records table by label. */
    columnHeader(table: string, label: string): Locator {
        return this.recordsTable(table).getByRole('columnheader', {
            name: label
        });
    }

    /** The sort button inside a column header, by the column's label. */
    sortHeader(label: string): Locator {
        return this.page.getByRole('button', { name: `Sort by ${label}` });
    }

    /** The filter-drawer trigger ("Filters" / "Filters (N)"). */
    get filtersButton(): Locator {
        return this.page.getByRole('button', { name: /Filters/ });
    }

    /** The records pagination "Next page" control. */
    get nextPage(): Locator {
        return this.page.getByRole('button', { name: 'Next page' });
    }

    /** The records empty/no-match title. */
    get noRecordsMatch(): Locator {
        return this.page.getByText('No records match');
    }

    /** Every column header in the records table (incl. the leading checkbox). */
    columnHeaders(table: string): Locator {
        return this.recordsTable(table).getByRole('columnheader');
    }

    /** The drag handle for a column row in the column picker, used to reorder it. */
    reorderHandle(label: string): Locator {
        return this.page.getByRole('button', {
            name: `Reorder ${label} column`
        });
    }

    /** The header select-all checkbox. */
    get selectAll(): Locator {
        return this.page.getByRole('checkbox', {
            name: 'Select all rows on this page'
        });
    }

    /** The selection checkbox in a given data row. */
    rowCheckbox(table: string, index: number): Locator {
        // Each data row carries exactly one checkbox; its accessible name is the
        // row's own label ("Select <first field value>"), so match by role.
        return this.recordRows(table).nth(index).getByRole('checkbox');
    }

    /**
     * The row-actions menu trigger (kebab) in a given data row. Its accessible
     * name carries the row's own title ("Actions for {title}"), so that ten
     * rows don't offer ten identically-named buttons — matched by prefix here
     * so the handle works whatever the row is called.
     */
    rowActions(table: string, index: number): Locator {
        return this.recordRows(table)
            .nth(index)
            .getByRole('button', { name: /^Actions for / });
    }

    /** Every row-actions trigger in the table, for name-uniqueness assertions. */
    rowActionTriggers(table: string): Locator {
        return this.recordsTable(table).getByRole('button', {
            name: /^Actions for /
        });
    }

    /** The rows-per-page select trigger in the records footer. */
    get rowsPerPage(): Locator {
        return this.page.getByRole('combobox', { name: 'Rows per page' });
    }

    /**
     * The records table's live status region text (result count + view + sort).
     *
     * Narrowed to the **unlabelled** status regions on purpose. `LoadedRecordsView`
     * renders the filter builder above its own two announcers, and the builder's
     * region carries `aria-label="Filter builder status"` — so a bare
     * `p[role="status"]` .first() silently retargets to the builder the moment a
     * test applies a filter, and then reports the records assertion as an empty
     * string rather than as the wrong element.
     */
    get recordsStatus(): Locator {
        return this.page.locator('p[role="status"]:not([aria-label])').first();
    }

    /** The records "Page X of Y" readout. */
    get pageReadout(): Locator {
        return this.page.getByText(/^Page \d+ of \d+$/);
    }

    /**
     * The Content **sidebar's** own error state. The work-area pane raises an
     * alert with the same title, so this is narrowed by the body copy only the
     * pane carries — the sidebar's is deliberately terse.
     */
    get sidebarError(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'Couldn’t load content types' })
            .filter({ hasNotText: 'Something went wrong' });
    }

    /** A row-actions menu item by its label (the menu must be open). */
    actionItem(label: string | RegExp): Locator {
        return this.page.getByRole('menuitem', { name: label });
    }

    /** The "{n} selected" count text in the selection bar. */
    get selectionCount(): Locator {
        return this.page.getByText(/\d+ selected/);
    }

    /** The selection bar's Clear button. */
    get clearSelection(): Locator {
        return this.page.getByRole('button', { name: 'Clear' });
    }

    /** Visible text in the selected-type / placeholder pane. */
    paneText(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    /** The "no content types" empty-state title. */
    get emptyTitle(): Locator {
        return this.page.getByText('No content types yet');
    }

    /**
     * The load-error title, in the **pane**.
     *
     * A failed `GET /content-schema` also puts a `ContentSidebarError` alert
     * beside it carrying the same sentence, so a bare `getByText` matches two
     * nodes and fails Playwright's strict mode.
     *
     * Selected by the design-system `AlertTitle`'s `data-slot`, which only the
     * pane's copy carries — the sidebar hand-rolls its alert out of a `<span>`.
     * This used to be `getByRole('heading')`, which stopped matching anything
     * when `AlertTitle` deliberately gave up its hardcoded `<h5>` (`ORT-168`):
     * a banner's title is a status message, not a section of the document, and
     * the rank it should carry depends on where the banner is mounted. The
     * `Alert` names itself with `aria-labelledby` instead, so there is no
     * heading here to find.
     */
    get errorTitle(): Locator {
        return this.page
            .locator('[data-slot="alert-title"]')
            .filter({ hasText: 'Couldn’t load content types' });
    }

    /**
     * The **pane** error state's retry button. Scoped through the alert that
     * carries the heading, because the sidebar's error alert offers a "Try
     * again" of its own.
     */
    get retry(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ has: this.errorTitle })
            .getByRole('button', { name: 'Try again' });
    }

    // --- i18n (from @apograph/i18n-admin, via the content library slots) ---

    /**
     * The records-toolbar locale switcher trigger (label reads "Locale: {name}").
     *
     * The lookahead excludes the unknown-locale state, whose name also starts
     * "Locale: " — a spec asserting the healthy switcher is *absent* has to not
     * match the control that replaced it.
     */
    get localeSwitcher(): Locator {
        return this.page.getByRole('button', { name: /^Locale: (?!unknown)/ });
    }

    /** A locale option inside the open switcher popover. */
    localeOption(name: string | RegExp): Locator {
        return this.page.getByRole('option', { name });
    }

    /**
     * The switcher when the URL names a locale that is not configured. It is a
     * **different** control from {@link localeSwitcher} on purpose — the
     * healthy one is named for the locale it is showing, and this one must not
     * borrow that name while the list is scoped to something else.
     */
    get unknownLocaleSwitcher(): Locator {
        return this.page.getByRole('button', {
            name: /Locale: unknown locale/
        });
    }

    /** The switcher's failed-read state (the locale list could not be read). */
    get localesUnavailable(): Locator {
        return this.page.getByRole('button', { name: /Locales could not be/ });
    }

    /** The locale panel's failed-read alert in the entry editor. */
    get localeWidgetError(): Locator {
        return this.page.getByText(/other locales couldn’t be loaded/);
    }

    /** The switcher's search box — a combobox over the locale listbox. */
    get localeSearch(): Locator {
        return this.page.getByRole('combobox', { name: 'Search locales…' });
    }

    /** Turn on the optional **Locales** column via the column picker. */
    async showLocalesColumn(): Promise<void> {
        await this.columnsButton.click();
        await this.columnOption('Locales').click();
        await this.columnsButton.click();
    }

    /** Open the locale switcher and pick a locale by its option name. */
    async selectLocale(name: string | RegExp) {
        await this.localeSwitcher.click();
        await this.localeOption(name).click();
    }

    /** The transient "Switching to …" overlay shown while a locale switch plays. */
    get localeSwitchOverlay(): Locator {
        return this.page.getByText(/Switching to/);
    }

    /**
     * Wait for a locale switch to finish covering the page.
     *
     * The cover marks the app root `inert` while it is up — it is opaque, so
     * input must not reach the controls behind it. Anything a spec does to the
     * page during that window is therefore dropped on the floor, exactly as it
     * would be for a user, which shows up as a fill that never lands rather
     * than as an error. Await this before interacting after a switch.
     */
    async localeSwitchSettled(): Promise<void> {
        await this.localeSwitchOverlay
            .first()
            .waitFor({ state: 'detached', timeout: 10_000 });
    }

    /** The entry editor's locale switcher (sidebar widget) title text. */
    get localeWidget(): Locator {
        return this.page.getByText('Locale', { exact: true });
    }

    /** The widget's "Translation group" label. */
    get localeGroupLabel(): Locator {
        return this.page.getByText('Translation group', { exact: true });
    }

    /** The info tooltip trigger beside the translation-group id. */
    get localeGroupHelp(): Locator {
        return this.page.getByRole('button', {
            name: 'What is the translation group?'
        });
    }

    /** The translation-group id value shown in the widget. */
    localeGroupId(id: string): Locator {
        return this.page.getByText(id, { exact: true });
    }

    /** The current-locale chip beside the entry-editor title (aria-labelled). */
    get editorTitleChip(): Locator {
        return this.page.getByLabel(/Current locale/);
    }

    /** The switch-to-create control for a not-yet-translated locale in the widget. */
    createTranslation(localeName: string): Locator {
        return this.page.getByRole('button', {
            name: `Create the ${localeName} translation`
        });
    }

    /** The switch control for an existing sibling locale in the widget. */
    switchLocale(localeName: string): Locator {
        return this.page.getByRole('button', {
            name: `Switch to the ${localeName} version`
        });
    }

    /**
     * The entry editor's Properties panel (the shell's right column).
     *
     * Located by its accessible **name** rather than its role, because the role
     * changes with the viewport. As a column it is `complementary` — chrome
     * beside the page. Under `md` it is a fixed overlay covering the page, and
     * since `ORT-154` gave it real focus containment (everything behind it goes
     * `inert`) it says so with `role="dialog"` + `aria-modal="true"`. One handle
     * across both layouts; {@link propertiesOverlay} is the narrow-viewport
     * shape when a spec means that specifically.
     */
    get propertiesPanel(): Locator {
        return this.page.locator('aside[aria-label="Properties"]');
    }

    /**
     * The Properties panel **as a narrow-viewport modal overlay** — the shape it
     * only takes under `md`, and only once the page behind it is `inert`
     * (`ORT-154`).
     */
    get propertiesOverlay(): Locator {
        return this.page.getByRole('dialog', { name: 'Properties' });
    }

    /**
     * The panel's own collapse control, in its header. Only one of this and
     * {@link showPropertiesButton} is reachable at a time: collapsing puts this
     * one inside the `inert` `<aside>`, and reopening unmounts the other. That is
     * why the shell has to hand focus between them.
     */
    get hidePropertiesButton(): Locator {
        return this.page.getByRole('button', { name: 'Hide Properties' });
    }

    /** The reopen control the shell puts in the page's top bar once collapsed. */
    get showPropertiesButton(): Locator {
        return this.page.getByRole('button', { name: 'Show Properties' });
    }

    /**
     * The dimming scrim behind the panel when it overlays a narrow viewport.
     * Located by shape because it is deliberately nameless and `aria-hidden` — it
     * is decoration, and its dismiss behaviour has keyboard equivalents (`Esc`
     * and the panel's own collapse button) rather than being a control itself.
     */
    get propertiesScrim(): Locator {
        return this.page.locator('div[aria-hidden="true"].fixed.inset-0');
    }

    /**
     * The shell's persisted right-panel preference (`apograph:right-panel`).
     *
     * Read from storage rather than inferred from the column, because the defect
     * this exists for is invisible on screen at the moment it happens: a narrow
     * viewport is *right* to start collapsed, and the bug was writing that forced
     * value back over the desktop preference.
     */
    async storedRightPanelState(): Promise<string | null> {
        return this.page.evaluate(() =>
            (globalThis as unknown as BrowserGlobals).localStorage.getItem(
                'apograph:right-panel'
            )
        );
    }

    /**
     * The publish-state badge in the Properties panel's **Details** block —
     * "Not saved yet" / "Draft" / "Modified" / "Published". Anchored on the
     * row's own `Status` term rather than the badge text, so it reads whatever
     * the badge currently says instead of asserting a state into existence.
     */
    get entryDetailsStatus(): Locator {
        return this.propertiesPanel
            .locator('dl > div')
            .filter({ has: this.page.getByText('Status', { exact: true }) })
            .locator('dd');
    }

    // --- alarms (from @apograph/alarms-admin, via the content library slots) ---

    /**
     * The records toolbar's "Save as alarm" action.
     *
     * By its accessible name rather than its visible text: the label the
     * component gives it says what pressing it *does* ("Watch for the records
     * this filter matches"), and the visible words are a shorthand that also
     * appear as the dialog's own title once it opens.
     */
    get saveAsAlarm(): Locator {
        return this.page.getByRole('button', {
            name: 'Watch for the records this filter matches'
        });
    }

    /** The "Save as alarm" dialog. */
    get saveAlarmDialog(): Locator {
        return this.page
            .getByRole('dialog')
            .filter({ hasText: 'Save as alarm' });
    }

    /** Name the alarm and what editors will read on a flagged record. */
    async fillSaveAlarmDialog(name: string, findingTitle: string) {
        await this.saveAlarmDialog.getByLabel('Alarm name').fill(name);
        await this.saveAlarmDialog
            .getByLabel('What editors will see')
            .fill(findingTitle);
    }

    /** The dialog's commit ("Save and check"). */
    get saveAlarmSubmit(): Locator {
        return this.saveAlarmDialog.getByRole('button', {
            name: 'Save and check'
        });
    }

    /**
     * The entry rail's **Checks** block — alarms' `ENTRY_SIDEBAR_WIDGET_SLOT`
     * contribution, and the surface the whole feature exists for.
     *
     * Located through its heading rather than by role: `EntrySidebarSection`
     * renders a bare `<section>` with no accessible name, so it is not exposed
     * as a `region` and there is nothing to ask for by name. Scoped to the
     * Properties panel so the words inside it cannot resolve against the form.
     */
    get entryChecksSection(): Locator {
        return this.propertiesPanel.locator('section').filter({
            has: this.page.getByRole('heading', { name: 'Checks', level: 3 })
        });
    }

    /**
     * The Checks block's busy state.
     *
     * A bare spinner: the design system's `Spinner` is `aria-hidden` by
     * default and this call site wraps it in no named status region, so there
     * is no role, no name and no text to reach — only the animation class.
     * Located by shape for that reason, the same escape hatch the properties
     * scrim uses.
     */
    get entryChecksSpinner(): Locator {
        return this.entryChecksSection.locator('svg.ds-spinner');
    }

    /**
     * Turn on an optional extension column via the column picker.
     *
     * Every contributed column is hidden by default, so a suite that wants one
     * has to switch it on the way a person would — which is also the only way
     * to observe the `isVisible` half of the contract, since a column that is
     * off must cost no request at all.
     */
    async showColumn(label: string): Promise<void> {
        await this.columnsButton.click();
        await this.columnOption(label).click();
        await this.columnsButton.click();
    }

    /**
     * The 1-based `<td>` position of a column, resolved at runtime by its
     * header text.
     *
     * An extension column is appended after the schema fields and Status but
     * before Updated, so its index depends on the type — reading it off the
     * header row keeps the assertion about the cell rather than about the seed
     * a suite happens to use.
     */
    async columnIndex(table: string, label: string): Promise<number> {
        const labels = await this.columnHeaders(table).allInnerTexts();
        return labels.findIndex((text) => text.trim() === label) + 1;
    }

    /** That column's cells across every data row. */
    async columnCells(table: string, label: string): Promise<Locator> {
        return this.recordColumnCells(
            table,
            await this.columnIndex(table, label)
        );
    }

    /**
     * One column's cell in the row carrying `rowText` — by the record rather
     * than by position, so an assertion about one seeded record does not
     * silently move to a different row when the list's order changes.
     */
    async columnCellIn(
        table: string,
        label: string,
        rowText: string
    ): Promise<Locator> {
        const index = await this.columnIndex(table, label);
        return this.recordRows(table)
            .filter({ hasText: rowText })
            .locator(`td:nth-child(${index})`);
    }

    /** Turn on the optional **Checks** column via the column picker. */
    async showChecksColumn(): Promise<void> {
        await this.showColumn('Checks');
    }

    /** The 1-based `<td>` position of the Checks column. */
    async checksColumnIndex(table: string): Promise<number> {
        return this.columnIndex(table, 'Checks');
    }

    /** The Checks cells of every data row. */
    async checksCells(table: string): Promise<Locator> {
        return this.columnCells(table, 'Checks');
    }

    /** The Checks cell of the row carrying `rowText`. */
    async checksCellIn(table: string, rowText: string): Promise<Locator> {
        return this.columnCellIn(table, 'Checks', rowText);
    }

    /* --- Bulk actions + the publish pre-flight dialog --------------------- */

    /** The selection bar's "Bulk actions" dropdown trigger. */
    get bulkActions(): Locator {
        return this.page.getByRole('button', { name: 'Bulk actions' });
    }

    /** One item of the open bulk-actions menu. */
    bulkAction(label: string): Locator {
        return this.page.getByRole('menuitem', { name: label, exact: true });
    }

    /** The bulk-publish pre-flight modal. */
    get bulkPublishDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /**
     * The per-row verdict note ("Will publish", "1 issue", "Already
     * published", "No longer available").
     *
     * `exact` on purpose: a substring match also resolves the row's wrapper and
     * its list item, so a loose locator reports three hits for one note and a
     * count assertion stops meaning anything.
     */
    verdictNote(text: string): Locator {
        return this.bulkPublishDialog.getByText(text, { exact: true });
    }

    /** Every "Show field checks" disclosure trigger in the dialog. */
    get verdictCheckToggles(): Locator {
        return this.bulkPublishDialog.getByRole('button', {
            name: 'Show field checks'
        });
    }

    /**
     * The expanded per-field checklist items of the `index`-th verdict row.
     *
     * A failing check renders as `"{label}: {message}"` in one node and a
     * passing one as just `"{label}"`, so the whole row is read as text rather
     * than picked apart — which is also what a reader sees.
     *
     * Scoped through the verdict list's **direct** children rather than
     * `getByRole('listitem')`: an expanded row nests its checklist in a second
     * `<ul>`, so a flat role query returns rows and checks interleaved in DOM
     * order and `.nth(1)` silently means "row 2" or "row 1's first check"
     * depending on which rows happen to be open.
     */
    verdictChecks(index: number): Locator {
        return this.bulkPublishDialog
            .locator('ul')
            .first()
            .locator('> li')
            .nth(index)
            .locator('ul li');
    }

    /**
     * The dialog's confirm button. Its label carries the **publishable** count
     * ("Publish 2 valid"), not the selection size, so passing the number is
     * what makes the assertion about the dry run rather than about the click.
     */
    bulkPublishConfirm(validCount: number): Locator {
        return this.bulkPublishDialog.getByRole('button', {
            name: `Publish ${validCount} valid`
        });
    }
}
