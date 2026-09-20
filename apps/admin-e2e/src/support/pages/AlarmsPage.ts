import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for content alarms — the workspace page at
 * `/workspaces/:id/alarms` and the rule editor at `.../alarms/rules/:ruleId`
 * (from `@orthacms/alarms-admin`). Seed it with `mockSignedIn`,
 * `mockWorkspaces` and `mockAlarmsApi`.
 *
 * Locators go through roles and visible text throughout: the condition editor's
 * defect was that it *looked* right, so a suite that reached for test ids would
 * have reproduced the same blind spot in a different language.
 */
export class AlarmsPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    /** Navigate to a workspace's alarms page. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/alarms`);
    }

    /** Navigate straight to the create form. */
    async gotoNewRule(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/alarms/rules/new`);
    }

    /** The alarms page's "New alarm" action. */
    newAlarmButton(): Locator {
        return this.page.getByRole('button', { name: 'New alarm' });
    }

    /** Pick the collection the alarm watches (create form only). */
    async chooseContentType(label: string) {
        await this.page
            .getByRole('combobox', { name: 'What to watch' })
            .click();
        await this.page.getByRole('option', { name: label }).click();
    }

    /** Fill the alarm's name. */
    async fillAlarmName(value: string) {
        await this.page.getByLabel('Alarm name').fill(value);
    }

    /** Fill what editors will see on a flagged record. */
    async fillFindingTitle(value: string) {
        await this.page.getByLabel('What editors will see').fill(value);
    }

    /** Navigate straight to one rule's editor. */
    async gotoRule(workspaceId: string, ruleId: string) {
        await this.page.goto(
            `/workspaces/${workspaceId}/alarms/rules/${ruleId}`
        );
    }

    /** The page heading. */
    heading(): Locator {
        return this.page.getByRole('heading', { name: 'Alarms', level: 1 });
    }

    // --- the page-context bar (the chrome every other section carries) ---

    /** The breadcrumb trail in the page top bar. */
    breadcrumb(): Locator {
        return this.page.getByRole('navigation', { name: 'Breadcrumb' });
    }

    /** A breadcrumb link by label — the way back to the list. */
    breadcrumbLink(label: string): Locator {
        return this.breadcrumb().getByRole('link', { name: label });
    }

    /** The trail's current-page crumb. */
    breadcrumbCurrent(label: string): Locator {
        return this.breadcrumb().getByText(label, { exact: true });
    }

    // --- the three tabs ---

    /** One of the Flagged / Alarms tabs. */
    tab(name: 'Flagged' | 'Alarms'): Locator {
        // A `radiogroup`, not a `group`: the design system's SegmentedControl
        // is a Radix ToggleGroup in single-select mode, so the items are radios
        // and the container takes the matching role.
        return this.page
            .getByRole('radiogroup', { name: 'Alarms view' })
            .getByRole('radio', { name: new RegExp(`^${name}`) });
    }

    // --- findings, grouped by alarm ---

    /**
     * One alarm's collapsible group header, by the alarm's name.
     *
     * The accessible name leads with the severity word — `aria-label` on a
     * button replaces its descendant text, so an `sr-only` word inside the
     * trigger would never be read — hence the prefix here rather than `^`.
     */
    group(name: string): Locator {
        return this.page.getByRole('button', {
            name: new RegExp(`^(Error|Warning|Info): ${name} — `)
        });
    }

    /** Expand one alarm's group. */
    async openGroup(name: string) {
        await this.group(name).click();
    }

    /** The Re-check button on one alarm's group header. */
    groupRecheck(name: string): Locator {
        return this.page.getByRole('button', {
            name: `Re-check ${name} against the whole collection`
        });
    }

    /** The records list inside one alarm's group. */
    groupList(name: string): Locator {
        return this.page.getByRole('list', {
            name: `Records flagged by ${name}`
        });
    }

    /** One record row inside a group, by any text it shows. */
    groupRow(name: string, text: string): Locator {
        return this.groupList(name)
            .getByRole('listitem')
            .filter({ hasText: text });
    }

    /** The centred empty state's heading. */
    emptyHeading(text: string): Locator {
        return this.page.getByRole('heading', { name: text, level: 2 });
    }

    /**
     * The severity glyph on one alarm's group header.
     *
     * The trigger draws two SVGs: the chevron first, then the severity's own
     * shape. Located positionally because the glyph is `aria-hidden` — it has
     * to be, since the word beside it carries the same fact — so there is no
     * role or name to reach it by. Its **markup** is the assertion: a build
     * that drew one shape for all three severities would leave colour doing the
     * work alone, and that is invisible to any name-based locator.
     */
    groupSeverityGlyph(name: string): Locator {
        return this.group(name).locator('svg').nth(1);
    }

    // --- the four reading surfaces' loading / error / empty states ---

    /**
     * The page-level busy state — the route's `Suspense` fallback and the first
     * request's wait, announced as one named `role="status"`.
     */
    loadingRegion(): Locator {
        return this.page.getByText('Loading alarms…');
    }

    /** The findings list's own failed-read alert (the Flagged tab). */
    findingsError(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: "Couldn't load findings" });
    }

    /** The rule list's failed-read alert (the Alarms tab). */
    rulesError(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: "Couldn't load alarms" });
    }

    /** The rule list's empty state — an alert, not the centred figure. */
    rulesEmpty(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'No alarms yet' });
    }

    /** The card for one alarm on the Alarms tab, by the alarm's name. */
    ruleCard(name: string): Locator {
        return this.page
            .getByRole('list', { name: 'Alarms' })
            .getByRole('listitem')
            .filter({ hasText: name });
    }

    /**
     * The workspace sidebar's Alarms entry (`WORKSPACE_NAV_SLOT`). Scoped to
     * the "Tools" nav so it cannot resolve to the breadcrumb link of the same
     * name, and it is the in-app way onto the page after a workspace switch —
     * which is the only way to reach the second workspace without throwing the
     * query cache away with a full page load.
     */
    navLink(): Locator {
        return this.page
            .getByRole('navigation', { name: 'Tools' })
            .getByRole('link', { name: 'Alarms' });
    }

    /** The "You cannot view alarms" card shown without `alarms:read`. */
    noAccessCard(): Locator {
        return this.page
            .getByRole('alert')
            .filter({ hasText: 'You cannot view alarms' });
    }

    // --- the rule editor's condition block ---

    /** The condition panel's heading. */
    conditionHeading(): Locator {
        return this.page.getByRole('heading', { name: 'Flag a record when…' });
    }

    /** The Edit conditions / Done editing toggle. */
    conditionToggle(): Locator {
        return this.page.getByRole('button', {
            name: /Edit conditions|Done editing/
        });
    }

    /**
     * The query-builder region the toggle controls.
     *
     * Overriding `filterSurface` is what the base class is built for — the
     * editor mounts the builder as an inline panel rather than the drawer, so
     * every shared helper (`applyButton`, `addRule`, `selectField`,
     * `filterFieldsError`) works here unchanged.
     */
    override filterSurface(): Locator {
        return this.page.getByRole('region', {
            name: /Edit conditions|Done editing/
        });
    }

    /** Alias, for specs that read better naming the thing rather than the role. */
    conditionPanel(): Locator {
        return this.filterSurface();
    }

    /**
     * One committed condition, as a summary chip.
     *
     * This is the read-out that makes Apply visible: before it existed,
     * committing a condition changed nothing on screen.
     */
    conditionChip(text: string | RegExp): Locator {
        return this.page
            .locator('span')
            .filter({ has: this.page.locator('[data-qb-chip-remove]') })
            .filter({ hasText: text });
    }

    /** Every committed condition chip. */
    conditionChips(): Locator {
        return this.page
            .locator('span')
            .filter({ has: this.page.locator('[data-qb-chip-remove]') });
    }

    /** Drop every committed condition via the summary's own "Clear all". */
    async clearAllConditions() {
        await this.page.getByRole('button', { name: 'Clear all' }).click();
    }

    /** The live "N records match" read-out under the conditions. */
    matchCount(): Locator {
        return this.page.getByText(/record[s]? match|No records match/);
    }

    /** The notice that says the conditions on screen are not saved yet. */
    unsavedNotice(): Locator {
        return this.page.getByText(
            'Conditions changed. Nothing is flagged or cleared until you save.'
        );
    }

    /**
     * The editor's committing button — "Save changes" when editing, "Create
     * alarm" on the create form. One locator, because every assertion about it
     * is about the same thing: whether the form can be committed.
     */
    saveButton(): Locator {
        return this.page.getByRole('button', {
            name: /Save changes|Create alarm/
        });
    }

    /**
     * The panel's loading state while the filterable-field surface is in
     * flight. `filterFieldsError` (the failed case) comes from `BasePage`.
     */
    fieldsLoading(): Locator {
        return this.page.getByText('Loading filterable fields…');
    }
}
