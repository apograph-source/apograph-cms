import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Common base for all page objects: holds the Playwright `page` and the shared
 * query-builder filter helpers (`@orthacms/query-builder-admin`), since the
 * builder is the same component wherever a list page mounts it. Each page
 * points {@link BasePage.filterSurface} at the surface it mounts — every list
 * page now uses the inline panel — and the helpers below work unchanged.
 */
export abstract class BasePage {
    constructor(protected readonly page: Page) {}

    // --- toolbar account menu (shell chrome, contributed by users-admin) ---

    /** The trailing account-menu trigger (the avatar button). */
    accountMenuTrigger(): Locator {
        return this.page.getByRole('button', { name: 'Account menu' });
    }

    /** Open the account menu. */
    async openAccountMenu() {
        await this.accountMenuTrigger().click();
    }

    /** An account-menu item by label (e.g. "My profile", "Logout"). */
    accountMenuItem(label: string): Locator {
        return this.page.getByRole('menuitem', { name: label });
    }

    /**
     * The signed-in address as the account-menu trigger states it.
     *
     * Scoped to the trigger, because the same address is a legitimate second
     * match elsewhere on a page that lists people — the Members table renders
     * it in every matching row. A page-wide `getByText(email)` therefore races
     * the roster: it resolves to one node until that table paints and to two
     * afterwards, and the second one is a **strict-mode violation**, which does
     * not retry. That is a latent trip-wire on any assertion about the account,
     * so the scope belongs here rather than in each spec.
     */
    accountMenuEmail(email: string): Locator {
        return this.accountMenuTrigger().getByText(email);
    }

    // --- command palette (sidebar search, shell chrome) ---

    /** The sidebar search trigger that opens the ⌘K command palette. */
    searchTrigger(): Locator {
        return this.page.getByRole('button', { name: 'Search', exact: true });
    }

    /** Open the command palette via the sidebar search trigger. */
    async openCommandPalette() {
        await this.searchTrigger().click();
        await this.commandInput().waitFor();
    }

    /** The palette's search input. */
    commandInput(): Locator {
        return this.page.getByPlaceholder('Search or jump to…');
    }

    /**
     * A palette result (a command option) by its exact accessible name. Exact,
     * because a workspace ("Marketing site") is a substring of its content-type
     * results ("Blog posts Marketing site").
     */
    commandItem(name: string): Locator {
        return this.page.getByRole('option', { name, exact: true });
    }

    /** The toolbar "Filters" trigger (its label carries the active count). */
    filterTrigger(): Locator {
        return this.page.getByRole('button', { name: /^Filters/ });
    }

    /**
     * The `QueryBuilderDrawer` surface (a modal dialog titled "Query Builder").
     *
     * **No page in this repo mounts it** — Members was the last consumer and
     * has migrated to the inline panel. Kept for a consumer that mounts the
     * still-published drawer; it is not the default surface, because a default
     * nothing renders would fail a page that forgot to override with a locator
     * timeout instead of a useful message.
     */
    filterDrawer(): Locator {
        return this.page.getByRole('dialog', { name: 'Query Builder' });
    }

    /**
     * The surface hosting the query builder: the inline **panel** (a `region`
     * labelled by the "Filters" toggle), which is what every list page mounts.
     * A page whose region is named something else — the alarms rule editor —
     * overrides this, and the shared helpers below then work unchanged.
     */
    filterSurface(): Locator {
        return this.page.getByRole('region', { name: /Filters/ });
    }

    /**
     * Open the filter surface (drawer or inline panel).
     *
     * The wait that means anything is on the toggle's own `aria-expanded`, not
     * on the surface. The inline panel collapses by animating an ancestor's
     * `grid-template-rows` to `0fr` under `overflow-hidden`, so a closed panel
     * is **clipped, not hidden**: the `region` keeps its full-size box and
     * Playwright calls it visible either way. `waitFor()` on it alone therefore
     * asserted nothing — it returned on the closed panel just as happily — and
     * every `openFilters()` + `applyFilters()` pair went on to race the
     * opening. That matters because a click whose `mouseup` lands after the
     * contents have shifted fires on the common ancestor instead of the button,
     * and Playwright reports it as a successful click, so the action is lost in
     * silence rather than failing.
     */
    async openFilters() {
        await this.filterTrigger().click();
        await expect(this.filterTrigger()).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        await this.filterSurface().waitFor();
    }

    /** Add a rule to the (root) group. */
    async addRule() {
        await this.filterSurface()
            .getByRole('button', { name: 'Add rule' })
            .click();
    }

    /** The field / operator / value comboboxes of the first rule, in order. */
    private ruleCombobox(index: number): Locator {
        return this.filterSurface().getByRole('combobox').nth(index);
    }

    /** Pick a field for the first rule by its visible label (e.g. "Status"). */
    async selectField(label: string) {
        await this.ruleCombobox(0).click();
        await this.page
            .getByRole('option', { name: label, exact: true })
            .click();
    }

    /**
     * Pick a field in the searchable, relation-grouped field picker: type
     * `search` to disambiguate a leaf label that repeats across relation groups
     * (e.g. "Name" under both "Author" and "Tags"), then click the leaf option.
     * Use for a relation-path field (`author.name`); {@link selectField} still
     * works for a unique flat field.
     */
    async selectFieldSearch(search: string, optionLabel: string) {
        await this.ruleCombobox(0).click();
        await this.page
            .getByPlaceholder('Search fields and relations')
            .fill(search);
        await this.page
            .getByRole('option', { name: optionLabel, exact: true })
            .click();
    }

    /** Pick the operator for the first rule by its label (the second combobox). */
    async selectOperator(label: string) {
        await this.ruleCombobox(1).click();
        await this.page
            .getByRole('option', { name: label, exact: true })
            .click();
    }

    /** Pick an enum value for the first rule (the third combobox). */
    async selectEnumValue(label: string) {
        await this.ruleCombobox(2).click();
        await this.page
            .getByRole('option', { name: label, exact: true })
            .click();
    }

    /**
     * Tick members in the enum **multi**-select — the value editor an enum
     * field gets under `is one of`, which is a checkbox group rather than the
     * third combobox {@link selectEnumValue} drives.
     *
     * `click()`, not `check()`: Playwright's `_setChecked` re-reads the state a
     * tick later and raises a non-recoverable error if it hasn't landed, which
     * is a coin flip for any control that re-renders through a parent's state.
     */
    async pickEnumValues(...labels: string[]) {
        const group = this.filterSurface().getByRole('group', {
            name: 'Value'
        });
        for (const label of labels) {
            const box = group.getByRole('checkbox', { name: label });
            await box.click();
            await expect(box).toBeChecked();
        }
    }

    /**
     * One chip of the applied-filter summary — the resting read-out of one
     * condition, rendered only while the panel is collapsed; removing it
     * re-commits the narrowed tree at once.
     *
     * Matched on its `title`, which carries the whole condition ("Author · Name
     * contains Ada"). The visible text is split across spans, and the same
     * field label also appears on the rule row's trigger and in the builder's
     * status line — so a `getByText` for it is a strict-mode violation rather
     * than a locator.
     */
    filterChip(condition: string | RegExp): Locator {
        return this.page.getByTitle(condition);
    }

    /** The inline validation error rendered under an invalid rule. */
    ruleError(): Locator {
        return this.filterSurface().getByTestId('qb-rule-error');
    }

    /** Type a scalar value into the first rule's text input. */
    async fillValue(value: string) {
        await this.filterSurface().getByRole('textbox').last().fill(value);
    }

    /** The builder's Apply control — for asserting its enabled/disabled state. */
    applyButton(): Locator {
        return this.filterSurface().getByRole('button', { name: 'Apply' });
    }

    /** Commit the builder's draft to the URL. */
    async applyFilters() {
        await this.applyButton().click();
    }

    /**
     * The builder's own "couldn't load the filterable fields" state. Distinct
     * from an empty picker: without the field definitions every rule fails the
     * Apply gate, so the panel must say so rather than render a dead button.
     */
    filterFieldsError(): Locator {
        return this.filterSurface().getByRole('alert');
    }

    /**
     * Pick the operator by label for the first rule. Unlike
     * {@link selectOperator} this waits for the option list, so it works for
     * the operators added alongside relation filtering ("does not contain",
     * "is none of", "is not empty") whose labels are longer.
     */
    async selectOperatorExact(label: string) {
        await this.filterSurface().getByRole('combobox').nth(1).click();
        await this.page
            .getByRole('option', { name: label, exact: true })
            .click();
    }

    /** Clear all conditions from the builder. */
    async resetFilters() {
        await this.filterSurface()
            .getByRole('button', { name: 'Reset' })
            .click();
    }

    /**
     * Collapse the inline filter panel. The panel stays open after Apply (so
     * further edits don't need a re-open), and the applied-conditions summary
     * only renders while it's collapsed — so a summary assertion has to close
     * it first.
     */
    async closeFilters() {
        await this.filterTrigger().click();
        await expect(this.filterTrigger()).toHaveAttribute(
            'aria-expanded',
            'false'
        );
    }

    /**
     * Remove one applied condition from the summary. `label` is the chip's
     * "<path> <operator>" text — the remove button's accessible name is
     * "Remove condition <path> <operator>".
     */
    async removeFilterChip(label: string) {
        await this.page
            .getByRole('button', { name: `Remove condition ${label}` })
            .click();
    }

    /** Drop every applied condition from the summary in one action. */
    async clearAllFilters() {
        await this.page.getByRole('button', { name: 'Clear all' }).click();
    }
}
