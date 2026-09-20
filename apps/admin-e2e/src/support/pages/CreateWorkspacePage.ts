import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the full-page create-workspace wizard at `/workspaces/new`
 * (from `@orthacms/workspaces-admin`). A 3-step flow (Basics → Members →
 * Content); the page sits behind the shell's gate **and** the `workspaces:create`
 * permission, so tests must seed both via `mockSignedIn` and a workspaces mock.
 */
export class CreateWorkspacePage extends BasePage {
    /** The page `<h1>`. */
    readonly heading: Locator;
    /** The "Back to workspaces" link above the header. */
    readonly backLink: Locator;
    /** Basics: the workspace name input. */
    readonly nameInput: Locator;
    /** Basics: the slug input (auto-filled from the name). */
    readonly slugInput: Locator;
    /** Basics: the optional description textarea. */
    readonly descriptionInput: Locator;
    /** Basics primary action → Members (disabled until the basics are valid). */
    readonly continueToMembers: Locator;
    /** Members primary action → Content. */
    readonly continueToContent: Locator;
    /** Members skip action → Content. */
    readonly skipForNow: Locator;
    /** Content primary action — submits the wizard. */
    readonly createButton: Locator;
    /** Content skip action — submits with no content selection. */
    readonly skipAndCreate: Locator;
    /** The footer Back button (Members/Content steps). */
    readonly back: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Create workspace',
            level: 1
        });
        this.backLink = page.getByRole('link', {
            name: 'Back to workspaces'
        });
        this.nameInput = page.getByLabel('Workspace name');
        this.slugInput = page.getByLabel('Slug');
        this.descriptionInput = page.getByLabel('Description');
        this.continueToMembers = page.getByRole('button', {
            name: 'Continue to members'
        });
        this.continueToContent = page.getByRole('button', {
            name: 'Continue to content'
        });
        this.skipForNow = page.getByRole('button', { name: 'Skip for now' });
        this.createButton = page.getByRole('button', {
            name: 'Create workspace'
        });
        this.skipAndCreate = page.getByRole('button', {
            name: 'Skip & create'
        });
        this.back = page.getByRole('button', { name: 'Back' });
    }

    async goto() {
        await this.page.goto('/workspaces/new');
        await this.heading.waitFor();
    }

    /** A color swatch in the Basics step's avatar-color radiogroup. */
    colorSwatch(color: string): Locator {
        return this.page.getByRole('radio', {
            name: `Use the ${color} accent`
        });
    }

    /** The slug availability indicator text (e.g. "Available"). */
    slugStatus(text: string): Locator {
        return this.page.getByText(text, { exact: true });
    }

    /** A field-level validation message anywhere in the step. */
    fieldError(message: string): Locator {
        return this.page.getByText(message);
    }

    /**
     * The slug field's "we couldn't answer that" state — the availability
     * endpoint failed, so uniqueness is unknown and the step stays blocked. A
     * `role="alert"`, unlike the passive Checking/Available/Taken lines.
     */
    slugCheckFailed(): Locator {
        return this.page.getByRole('alert').filter({
            hasText: /Couldn’t check whether this slug is free/
        });
    }

    /** A sonner toast by text (success or failure of the submit). */
    toast(text: string | RegExp): Locator {
        return this.page.getByText(text);
    }

    /** Members step: the directory search box (an ARIA combobox). */
    get memberSearch(): Locator {
        return this.page.getByRole('combobox', {
            name: 'Add people by name or email'
        });
    }

    /** A result in the members typeahead's listbox. */
    memberOption(name: string | RegExp): Locator {
        return this.page.getByRole('option', { name });
    }

    /** The step card's `<h2>` — the focus target after a step change. */
    stepHeading(name: string): Locator {
        return this.page.getByRole('heading', { name, level: 2 });
    }

    /**
     * Walk the wizard with default members (just the owner) and content (all),
     * submitting at the end. `continueToMembers.click()` auto-waits for the slug
     * availability check to enable it.
     */
    async create(name: string) {
        await this.nameInput.fill(name);
        await this.continueToMembers.click();
        await this.continueToContent.click();
        await this.createButton.click();
    }
}
