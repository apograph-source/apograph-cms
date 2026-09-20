import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_NAV_SLOT
} from '@orthacms/workspaces-admin';
import { BarChart3 } from 'lucide-react';
import {
    INSIGHTS_SECTION_IDS,
    INSIGHTS_SECTION_SLOT,
    type InsightsSection
} from '../../presentation/slots/insightsSlots';
import { InsightsPageSkeleton } from '../../presentation/components/InsightsSkeleton';

const InsightsPage = lazy(() =>
    import('../../presentation/pages/InsightsPage').then((module) => ({
        default: module.InsightsPage
    }))
);

/**
 * The bands the Insights page ships with.
 *
 * Exported because they are **defaults, not a fixed set**: a host can pass a
 * different list to {@link InsightsPlugin}, spread these and append, or drop
 * them entirely with `sections: []` and let contributing plugins define every
 * band. The orders leave gaps of ten so a contributed section can slot between
 * two built-ins without renumbering anything.
 */
export const DEFAULT_INSIGHTS_SECTIONS: InsightsSection[] = [
    {
        id: INSIGHTS_SECTION_IDS.Overview,
        order: 10,
        titleId: 'insights.section.overview',
        defaultTitle: 'Overview'
    },
    {
        id: INSIGHTS_SECTION_IDS.Content,
        order: 20,
        titleId: 'insights.section.content',
        defaultTitle: 'Content'
    },
    {
        id: INSIGHTS_SECTION_IDS.Reach,
        order: 30,
        titleId: 'insights.section.reach',
        defaultTitle: 'Localisation & media'
    },
    {
        id: INSIGHTS_SECTION_IDS.Team,
        order: 40,
        titleId: 'insights.section.team',
        defaultTitle: 'Team'
    }
];

/** Options for {@link InsightsPlugin}. */
export type InsightsPluginConfig = {
    /**
     * The sections to register. Defaults to {@link DEFAULT_INSIGHTS_SECTIONS}.
     *
     * These go through `INSIGHTS_SECTION_SLOT` exactly like any other plugin's
     * contributions — there is no privileged set — so a host replacing them is
     * doing the same thing a plugin adding one does.
     */
    sections?: InsightsSection[];
};

/**
 * Admin-side insights plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config has a home.
 */
export type InsightsAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side Insights plugin.
 *
 * It lives **strictly inside a workspace**: no top-level route, no global nav
 * entry — just a rail button (`order: 30`) and an `insights/*` route on the
 * workspace shell's slots (owned by `@orthacms/workspaces-admin`).
 *
 * The plugin contributes **no widgets**. Every card on the page arrives through
 * `INSIGHTS_WIDGET_SLOT` from whichever package owns that data, and every band
 * through `INSIGHTS_SECTION_SLOT` — including the four below. A section with no
 * visible widgets renders nothing, so an install without `media-admin` simply
 * has no "Localisation & media" band.
 *
 * **Register this before any plugin that overrides one of its sections.**
 * Section contributions merge by `id` with the last one winning, so a package
 * renaming or reordering a built-in has to be registered after this. Widget
 * contributions are unaffected — `createAdmin` collects every plugin's slots in
 * one pass after all factories have run, so their order never matters.
 */
export function InsightsPlugin({
    sections = DEFAULT_INSIGHTS_SECTIONS
}: InsightsPluginConfig = {}): InsightsAdminPlugin {
    return {
        name: 'insights',
        slots: [
            {
                slot: WORKSPACE_NAV_SLOT,
                items: [
                    {
                        labelId: 'insights.nav.label',
                        defaultLabel: 'Insights',
                        to: 'insights',
                        order: 30,
                        icon: BarChart3,
                        iconColor: 'text-nav-amber'
                    }
                ]
            },
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        path: 'insights/*',
                        element: (
                            <Suspense fallback={<InsightsPageSkeleton />}>
                                <InsightsPage />
                            </Suspense>
                        )
                    }
                ]
            },
            {
                slot: INSIGHTS_SECTION_SLOT,
                items: sections
            }
        ]
    };
}
