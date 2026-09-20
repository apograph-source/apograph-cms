import type { ComponentType } from 'react';
import { createSlot } from '@orthacms/utils-admin';

/**
 * How wide a widget renders in the Insights grid, in twelfths.
 *
 * The grid is 12 columns: `xs` is 3, `sm` 4, `md` 6, `lg` 8, `full` 12. So four
 * `xs` stat tiles, or `sm` + `lg`, or `md` + `md`, each fill a row exactly.
 *
 * Sizes are a **request, not a guarantee** — below the `lg` breakpoint every
 * widget collapses toward full width, because a heat grid or a bar list squeezed
 * into a third of a phone screen is unreadable.
 */
export type InsightsWidgetSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

/**
 * Sort order used when an item omits `order`.
 *
 * Past the built-in sections (10–40), so a contributor who has no opinion lands
 * after the standard bands rather than in the middle of them.
 */
export const DEFAULT_INSIGHTS_ORDER = 100;

/**
 * One widget on the Insights page, contributed by the package that owns the
 * data behind it. The Insights plugin ships the page, the grid, the range
 * picker and the card shell — it contributes **no widgets of its own**.
 *
 * `Component` takes no props: like `shell-admin`'s `HOME_SECTION_SLOT`, a widget
 * reads what it needs (the open workspace, the selected range, its own query)
 * rather than being handed it. That keeps the page from having to know what any
 * given widget's data looks like.
 */
export type InsightsWidget = {
    /** Stable identity — the React key, and the handle a saved layout would use. */
    id: string;
    /**
     * The {@link InsightsSection} `id` this widget belongs under.
     *
     * Naming a section nobody registered is **not** an error and does not lose
     * the widget: it renders in a trailing catch-all band instead. A dashboard
     * that silently swallows a contribution is far worse than one with an
     * unlabelled group, because nothing anywhere says a card is missing.
     */
    section: string;
    /** Sort order within the section. Defaults to {@link DEFAULT_INSIGHTS_ORDER}. */
    order?: number;
    /** Grid width. Defaults to `md` (half a row). */
    size?: InsightsWidgetSize;
    /**
     * Permission required to see this widget at all.
     *
     * Carried on the item **as well as** being enforced inside the component,
     * for the same reason the workspace sidebar checks it twice: the page has to
     * know whether a section has any visible widgets *before* it renders that
     * section's heading, or an operator without `content:read` gets a "Content"
     * header sitting over nothing.
     */
    permission?: string;
    /** `react-intl` id for the widget's name. */
    titleId: string;
    /**
     * Fallback name. Used by the error boundary — "Gone quiet couldn't load" is
     * a far more useful failure than an anonymous broken card — and by any
     * future layout editor that has to list widgets without mounting them.
     */
    defaultTitle: string;
    /** The widget body. Renders its own `WidgetCard`. */
    Component: ComponentType;
};

/**
 * A named group of widgets, rendered as a labelled band on the Insights page.
 *
 * Sections are ordinary slot contributions — the four the Insights plugin ships
 * go through the same slot as anyone else's, so there is exactly one mechanism
 * and no privileged set. A section with no visible widgets renders nothing at
 * all, heading included.
 *
 * **Contributions merge by `id`, and a later one wins**, field by field. That is
 * what makes a built-in overridable: contribute `{ id: 'team', defaultTitle:
 * 'People' }` and the band is renamed without restating its order or icon. It
 * also means the Insights plugin must be registered *before* any package that
 * wants to override one of its bands.
 */
export type InsightsSection = {
    /** Stable identity, referenced by {@link InsightsWidget.section}. */
    id: string;
    /** Sort order among sections. Defaults to {@link DEFAULT_INSIGHTS_ORDER}. */
    order?: number;
    /** `react-intl` id for the section heading. */
    titleId: string;
    /** Fallback heading text. */
    defaultTitle: string;
    /** `react-intl` id for an optional line under the heading. */
    descriptionId?: string;
    /** Fallback text for that line. */
    defaultDescription?: string;
    /** Optional leading icon beside the heading. */
    icon?: ComponentType<{ className?: string }>;
};

/**
 * The extension point plugins contribute Insights widgets to.
 *
 * @example
 * ```tsx
 * slots: [
 *     {
 *         slot: INSIGHTS_WIDGET_SLOT,
 *         items: [
 *             {
 *                 id: 'insights.content.stale',
 *                 section: INSIGHTS_SECTION_IDS.Content,
 *                 order: 10,
 *                 size: 'md',
 *                 permission: 'content:read',
 *                 titleId: 'content.insights.stale.title',
 *                 defaultTitle: 'Gone quiet',
 *                 Component: StaleEntriesWidget
 *             }
 *         ]
 *     }
 * ]
 * ```
 */
export const INSIGHTS_WIDGET_SLOT =
    createSlot<InsightsWidget>('insights.widget');

/**
 * The extension point for Insights sections — open a new band, or override one
 * of the built-ins by contributing the same `id`.
 *
 * @example A plugin opening its own band
 * ```tsx
 * {
 *     slot: INSIGHTS_SECTION_SLOT,
 *     items: [
 *         {
 *             id: 'seo',
 *             order: 25,
 *             titleId: 'seo.insights.section',
 *             defaultTitle: 'Search',
 *             defaultDescription: 'How the site is being found.'
 *         }
 *     ]
 * }
 * ```
 */
export const INSIGHTS_SECTION_SLOT =
    createSlot<InsightsSection>('insights.section');

/**
 * Section ids the Insights plugin registers by default, so contributors
 * reference a constant rather than retyping a string that has to match exactly.
 *
 * These are **defaults, not a fixed set**: a host can replace them wholesale via
 * `InsightsPlugin({ sections })`, and any plugin can add to them or override one
 * through {@link INSIGHTS_SECTION_SLOT}.
 */
export const INSIGHTS_SECTION_IDS = {
    Overview: 'overview',
    Content: 'content',
    Reach: 'reach',
    Team: 'team'
} as const;
