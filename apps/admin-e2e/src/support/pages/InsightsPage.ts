import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for Insights at `/workspaces/:id/insights` (from
 * `@orthacms/insights-admin`) — the section bands, the widget cards and the
 * range picker. Seed it with `mockSignedIn`, `mockWorkspaces` and
 * `mockInsightsApi`.
 *
 * Widgets are located by their **card heading**, not by a test id: the whole
 * point of the slot system is that the page has no knowledge of what is on it,
 * so the suite should find a card the way a reader does. The one exception is
 * {@link widget}, which uses the slot's own `data-widget-id` — that attribute is
 * how the page identifies a contribution, so asserting on it is asserting on the
 * contract rather than on markup.
 */
export class InsightsPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    /** Navigate straight to a workspace's Insights page. */
    async goto(workspaceId: string) {
        await this.page.goto(`/workspaces/${workspaceId}/insights`);
    }

    /** The page heading. */
    heading(): Locator {
        return this.page.getByRole('heading', { name: 'Insights', level: 1 });
    }

    /** A section band's heading (e.g. "Content", "Team"). */
    section(name: string): Locator {
        return this.page.getByRole('heading', { name, level: 2 });
    }

    /**
     * A section band by the **id** its contribution registered. Sections come
     * through `INSIGHTS_SECTION_SLOT` like widgets do, so asserting on the id
     * is asserting on the slot contract rather than on the heading copy.
     */
    sectionBand(id: string): Locator {
        return this.page.locator(`[data-section-id="${id}"]`);
    }

    /**
     * The catch-all band that holds widgets naming an unregistered section. It
     * should not exist on a correctly-wired page — its presence means a
     * contribution's `section` id doesn't match any registration.
     */
    fallbackBand(): Locator {
        return this.page.locator('[data-section-fallback="true"]');
    }

    /** The grid cell of one contributed widget, by its slot id. */
    widget(id: string): Locator {
        return this.page.locator(`[data-widget-id="${id}"]`);
    }

    /** A widget card by its visible title. */
    card(title: string): Locator {
        return this.page
            .getByRole('heading', { name: title, level: 3 })
            .locator('xpath=ancestor::*[contains(@class,"rounded-xl")][1]');
    }

    /**
     * A breakdown option inside a widget card (e.g. "By type").
     *
     * `radio`, not `button` — a card's breakdown switch is the same design-system
     * `SegmentedControl` the range picker uses, and its Radix root takes radio
     * semantics so arrow keys move the selection.
     */
    cardBreakdown(title: string, option: string): Locator {
        return this.card(title).getByRole('radio', { name: option });
    }

    /** The error message a widget shows when its own request failed. */
    cardError(title: string): Locator {
        return this.card(title).getByRole('alert');
    }

    /** The loading skeleton inside a widget card. */
    cardSkeleton(title: string): Locator {
        return this.card(title).getByTestId('widget-skeleton');
    }

    /**
     * Every widget skeleton on the page. `toHaveCount(0)` on this is how a spec
     * says "the page has settled" — needed before an axe scan, since a
     * half-loaded page has a scrollable region with no focusable content in it.
     */
    anySkeleton(): Locator {
        return this.page.getByTestId('widget-skeleton');
    }

    /** The empty-state copy a widget shows when it loaded but has no data. */
    cardEmpty(title: string): Locator {
        return this.card(title).getByText(
            'Nothing to show for this period yet.'
        );
    }

    /** A widget's top-right chip (the accent beside its title). */
    cardChip(title: string, text: string | RegExp): Locator {
        return this.card(title).getByText(text);
    }

    /**
     * One bar row's graphic in a bar-list widget, located by the text
     * alternative it declares. The bars themselves have no text, so this is
     * both the locator and the thing under test.
     */
    cardBar(title: string, name: string | RegExp): Locator {
        return this.card(title).getByRole('img', { name });
    }

    /**
     * A stat tile by the **slot id** of the widget that contributes it.
     *
     * Not by its label: "Published" is a stat tile *and* a series name in the
     * pipeline widget's legend, so a text locator matches three cards. The slot
     * id is unambiguous and is the contract the page itself keys on.
     */
    statTile(widgetId: string): Locator {
        return this.widget(widgetId);
    }

    // --- range picker ---

    /**
     * The whole range control. A `radiogroup`, not a `group` — the design
     * system's `SegmentedControl` wraps a Radix single-select ToggleGroup,
     * whose root takes radio semantics so arrow keys move the selection.
     */
    rangePicker(): Locator {
        return this.page.getByRole('radiogroup', { name: 'Time range' });
    }

    /**
     * One range option, by its **visible** label (e.g. `7d`).
     *
     * Located loosely on purpose. The accessible name is the visible label
     * plus an `sr-only` unit — "90d days" — because `2.5.3 Label in Name`
     * requires the name to contain what is on screen, and an `aria-label` of
     * "90 days" replaced it instead. Keying the locator on the visible label
     * means the test asserts the half a speech-input user actually says.
     */
    rangeOption(label: string): Locator {
        return this.rangePicker().getByRole('radio', {
            name: new RegExp(`^${label}\\b`)
        });
    }

    /** Select a range window, by its visible label (e.g. `90d`). */
    async selectRange(label: string) {
        await this.rangeOption(label).click();
    }

    /** The "no widgets registered" copy shown when nothing contributes. */
    emptyPage(): Locator {
        return this.page.getByText(/No insights are available yet/);
    }

    /** A chart's collapsed table-view fallback, by its summary label. */
    tableView(): Locator {
        return this.page.getByText('Table view');
    }
}
