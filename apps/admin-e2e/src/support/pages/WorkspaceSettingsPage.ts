import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the workspace settings page at `/workspaces/:id/settings`
 * (from `@orthacms/workspaces-admin`). A left-rail page — General, Members,
 * Content, and Danger zone are nested routes reached from the side nav —
 * mounted inside the workspace shell. Backed by `mockWorkspaceSettingsApi` (the
 * stateful settings mock).
 */
export class WorkspaceSettingsPage extends BasePage {
    /** The page's `<h1>`. */
    readonly heading: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Settings',
            level: 1
        });
    }

    /** Navigate straight to a workspace's settings and wait for the heading. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/settings`);
        await this.heading.waitFor();
    }

    // --- left-rail section nav ---

    /** The settings side-rail nav (scopes section links away from the navbar). */
    get sectionNav(): Locator {
        return this.page.getByRole('navigation', {
            name: 'Workspace settings sections'
        });
    }

    /** A section entry in the left rail (a link). */
    navItem(name: string): Locator {
        return this.sectionNav.getByRole('link', { name });
    }

    /** Navigate to a section by clicking its rail entry. */
    async openSection(name: string) {
        await this.navItem(name).click();
    }

    /** Deep-link straight at one settings section, bypassing the tab bar. */
    async gotoSection(workspaceId: string, section: string) {
        await this.page.goto(`/workspaces/${workspaceId}/settings/${section}`);
        await this.heading.waitFor();
    }

    // --- gated-redirect arrival ---

    /**
     * The sr-only `role="status"` region a gated redirect writes its reason
     * into. The settings page renders exactly one, and it is empty until a
     * `<Navigate>` lands here carrying its notice — a redirect that says
     * nothing is the SPA analog of a silent one.
     */
    redirectNotice(): Locator {
        return this.page.getByRole('status');
    }

    /**
     * The shell's `<main>`, which is `tabIndex={-1}` for the skip link and is
     * where a gated redirect has to put focus: the page swapped under the user,
     * so leaving focus on `<body>` restarts their next Tab at the top of the
     * document.
     */
    mainContent(): Locator {
        return this.page.locator('#main-content');
    }

    // --- general ---

    get nameInput(): Locator {
        return this.page.getByLabel('Name');
    }

    get descriptionInput(): Locator {
        return this.page.getByLabel('Description');
    }

    get slugInput(): Locator {
        return this.page.getByLabel('URL slug');
    }

    /**
     * The read-only workspace id field (copyable, so focusable — not disabled).
     * Scoped by role: `getByLabel` substring-matches, so "Workspace ID" would
     * also resolve the "Copy workspace ID" button beside it.
     */
    get workspaceIdInput(): Locator {
        return this.page.getByRole('textbox', {
            name: 'Workspace ID',
            exact: true
        });
    }

    /** The icon-only button that copies the workspace id to the clipboard. */
    get copyWorkspaceIdButton(): Locator {
        return this.page.getByRole('button', { name: 'Copy workspace ID' });
    }

    colorSwatch(color: string): Locator {
        return this.page.getByRole('radio', {
            name: `Use the ${color} accent`
        });
    }

    get saveButton(): Locator {
        return this.page.getByRole('button', { name: 'Save changes' });
    }

    // --- members ---

    get memberSearch(): Locator {
        return this.page.getByPlaceholder('Add people by name or email');
    }

    /**
     * A directory-search result. The list follows the ARIA combobox pattern, so
     * results are `role="option"` rather than buttons — options aren't tab
     * stops; the input keeps focus and drives them with ↓/↑.
     */
    memberOption(name: string): Locator {
        return this.page.getByRole('option', { name: new RegExp(name) });
    }

    /** The roster row for a member (its email is unique in the list). */
    memberRow(email: string): Locator {
        return this.page.getByText(email, { exact: true });
    }

    memberRemoveButton(name: string): Locator {
        return this.page.getByRole('button', { name: `Remove ${name}` });
    }

    // --- content ---

    /** The trigger that opens the add-collections dialog. */
    get addCollectionsButton(): Locator {
        return this.page.getByRole('button', { name: 'Add collections' });
    }

    /** The trigger that opens the add-pages dialog. */
    get addPagesButton(): Locator {
        return this.page.getByRole('button', { name: 'Add pages' });
    }

    /** The add dialog's search box. */
    get addContentSearch(): Locator {
        return this.dialog.getByPlaceholder('Search content types');
    }

    /** A selectable content-type checkbox in the add dialog, by its label. */
    contentCheckbox(label: string): Locator {
        return this.dialog.getByRole('checkbox', { name: new RegExp(label) });
    }

    /** The add dialog's Save button (label reflects the selected count). */
    get addContentSave(): Locator {
        return this.dialog.getByRole('button', { name: /^Add/ });
    }

    /** The per-row remove control in the granted list. */
    contentRemoveButton(label: string): Locator {
        return this.page.getByRole('button', { name: `Remove ${label}` });
    }

    /** The Remove button inside the remove-content confirm dialog. */
    get removeContentConfirm(): Locator {
        return this.dialog.getByRole('button', { name: 'Remove', exact: true });
    }

    /** The blocking warning alert shown when a type still has entries. */
    get removeBlockedAlert(): Locator {
        return this.dialog.getByRole('alert');
    }

    /**
     * The "still counting" line a blocking dialog shows while its entry-count
     * read is in flight — a spinner plus its label. Shared verbatim by the
     * revoke-content and delete-workspace dialogs, which is the window in which
     * the destructive button must be disabled because nobody knows the count
     * yet.
     */
    get countCheckingNotice(): Locator {
        return this.dialog.getByText(/Checking for existing content/);
    }

    // --- danger ---

    get archiveButton(): Locator {
        return this.page.getByRole('button', { name: 'Archive', exact: true });
    }

    get unarchiveButton(): Locator {
        return this.page.getByRole('button', {
            name: 'Unarchive',
            exact: true
        });
    }

    get deleteButton(): Locator {
        return this.page.getByRole('button', { name: 'Delete workspace' });
    }

    /** The Delete button inside the delete confirm dialog. */
    get deleteConfirm(): Locator {
        return this.dialog.getByRole('button', { name: 'Delete workspace' });
    }

    /** The blocking warning alert shown when the workspace still has content. */
    get deleteBlockedAlert(): Locator {
        return this.dialog.getByRole('alert');
    }

    archivedBadge(): Locator {
        return this.page.getByText('Archived', { exact: true });
    }

    // --- the workspace nav the shell injects into the app sidebar ---

    /**
     * The sidebar's workspace switcher trigger. Its accessible name carries the
     * open workspace ("Switch workspace, current: {name}"), which is what makes
     * it the check for whether the sidebar picked up a settings change.
     */
    get workspaceSwitcher(): Locator {
        return this.page.getByRole('button', { name: /Switch workspace/ });
    }

    /**
     * The switcher's popover. Radix renders it `role="dialog"`; the component
     * promotes its "Switch workspace" heading to the accessible name by id, so
     * it is addressable without a test id and distinguishable from the settings
     * page's own confirm dialogs.
     */
    get workspaceSwitcherPopover(): Locator {
        return this.page.getByRole('dialog', { name: 'Switch workspace' });
    }

    /** Open the switcher popover and wait for it. */
    async openWorkspaceSwitcher() {
        await this.workspaceSwitcher.click();
        await this.workspaceSwitcherPopover.waitFor();
    }

    /**
     * One workspace row inside the open popover. Located by the row that
     * *contains* the exact name, not by accessible name: the row's name folds
     * in the avatar monogram and the "{n} members · active" sub-line, and
     * "Workspace 1" is a prefix of "Workspace 10".
     */
    switcherOption(name: string): Locator {
        return this.workspaceSwitcherPopover
            .getByRole('button')
            .filter({ has: this.page.getByText(name, { exact: true }) });
    }

    /** The popover's pinned "SWITCH WORKSPACE" heading (a styled paragraph). */
    get switcherHeadingText(): Locator {
        return this.workspaceSwitcherPopover.getByText('Switch workspace', {
            exact: true
        });
    }

    /** The popover's pinned "New workspace" action (below the list). */
    get switcherCreate(): Locator {
        return this.workspaceSwitcherPopover.getByRole('button', {
            name: 'New workspace'
        });
    }

    /**
     * The element rendering a workspace's **name** inside the popover — the
     * `truncate` span, located by its exact text rather than by class. Used for
     * the overflow geometry check below.
     */
    switcherOptionName(name: string): Locator {
        return this.workspaceSwitcherPopover.getByText(name, { exact: true });
    }

    /**
     * Whether a workspace's name is actually clipped by CSS (its text is wider
     * than the box drawing it) rather than widening the popover. A snapshot
     * would not tell the two apart. Runs in the page and types the node
     * structurally, since this project's tsconfig ships no DOM lib.
     */
    async switcherOptionNameIsClipped(name: string): Promise<boolean> {
        return this.switcherOptionName(name).evaluate((node: unknown) => {
            const el = node as { scrollWidth: number; clientWidth: number };
            return el.scrollWidth > el.clientWidth;
        });
    }

    // --- shared: confirm dialog + toasts ---

    get dialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /**
     * Whatever inside the open dialog holds focus — the dialog's own container
     * included, since Radix focuses that when it finds nothing better. `:focus`
     * matches at most one element in a document, so a count of `1` is the focus
     * trap holding and `0` is focus having escaped behind the modal.
     */
    focusInsideDialog(): Locator {
        return this.page.locator(
            '[role="dialog"]:focus, [role="dialog"] :focus'
        );
    }

    /** The confirm button inside the open dialog, by its label. */
    dialogConfirm(name: string): Locator {
        return this.dialog.getByRole('button', { name });
    }

    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }
}
