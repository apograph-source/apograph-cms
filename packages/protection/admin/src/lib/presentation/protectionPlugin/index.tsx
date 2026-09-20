import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    ENTRY_HEADER_SLOT,
    ENTRY_PUBLISH_GUARD_SLOT,
    ENTRY_SIDEBAR_WIDGET_SLOT,
    RECORDS_COLUMN_SLOT,
    RECORDS_FILTER_FIELDS_SLOT,
    type ContentTypeDetail,
    type EntryRecord
} from '@orthacms/content-admin';
import {
    INSIGHTS_SECTION_IDS,
    INSIGHTS_WIDGET_SLOT
} from '@orthacms/insights-admin';
import {
    WORKSPACE_NAV_SLOT,
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_SETTINGS_TAB_SLOT
} from '@orthacms/workspaces-admin';
import { Shield, ShieldCheck } from 'lucide-react';
import { ProtectionSettings } from '../components/ProtectionSettings';
import { ReviewsSkeleton } from '../components/ReviewsSkeleton';
import { ReviewChip } from '../components/ReviewChip';
import { ReviewSection } from '../components/ReviewSection';
import { usePublishProtectionVerdict } from '../slots/publishGuard';
import { ReviewColumnCell } from '../components/ReviewColumnCell';
import { ProtectionInsightsCard } from '../components/ProtectionInsightsCard';
import { useReviewStateFilterFields } from '../../application/useReviewStateFilterFields';
import { useReviewStatusByEntry } from '../../application/hooks';

// Lazy so the Reviews page is its own chunk, fetched when somebody first opens
// it — every other surface this plugin has is a slot contribution that rides
// screens the person was already on.
const ReviewsPage = lazy(() =>
    import('../pages/ReviewsPage').then((module) => ({
        default: module.ReviewsPage
    }))
);

/** Admin-side protection plugin shape — a named alias of {@link AdminPlugin}. */
export type ProtectionAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side protection plugin.
 *
 * **Eight contributions and one route of its own.** Almost everything this plugin
 * shows lives inside somebody else's screen — three in the entry editor, where
 * the requirement is met or missed, and one in workspace settings, where a rule
 * is made. The Reviews page is the exception, and it has to be: an ask arrives
 * against whichever type someone happened to be editing, so no single
 * collection's list can be where a reviewer looks for it.
 *
 * The three entry contributions render **nothing** on an unprotected type, so
 * an installation with no rule is byte-for-byte the admin it was before the
 * plugin was installed (`protection:I-04`, the client half). The settings tab
 * is the exception on purpose: it is where a workspace with no rule goes to get
 * one, so it has to be visible before there is anything to see.
 */
export function ProtectionPlugin(): ProtectionAdminPlugin {
    return {
        name: 'protection',
        slots: [
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        path: 'reviews',
                        // After the content library and alarms: somebody
                        // landing on a workspace wants their content, not
                        // their queue.
                        order: 50,
                        element: (
                            <Suspense fallback={<ReviewsSkeleton />}>
                                <ReviewsPage />
                            </Suspense>
                        )
                    }
                ]
            },
            {
                slot: WORKSPACE_NAV_SLOT,
                items: [
                    {
                        labelId: 'protection.nav.reviews',
                        defaultLabel: 'Reviews',
                        to: 'reviews',
                        order: 50,
                        icon: ShieldCheck,
                        // `content:read`, not `content:approve`: the "My
                        // requests" tab is an author checking on work they
                        // sent, and somebody who cannot approve still has to
                        // see whether anyone has looked.
                        permission: 'content:read'
                    }
                ]
            },
            {
                slot: ENTRY_HEADER_SLOT,
                items: [{ id: 'protection.review', Component: ReviewChip }]
            },
            {
                slot: ENTRY_SIDEBAR_WIDGET_SLOT,
                items: [{ id: 'protection.review', Component: ReviewSection }]
            },
            {
                slot: ENTRY_PUBLISH_GUARD_SLOT,
                items: [
                    {
                        id: 'protection.approvals',
                        useVerdict: usePublishProtectionVerdict
                    }
                ]
            },
            {
                slot: RECORDS_COLUMN_SLOT,
                items: [
                    {
                        id: 'protection.records.review',
                        label: {
                            id: 'protection.column.label',
                            defaultMessage: 'Review'
                        },
                        // Every publishable type: any of them can be given a
                        // rule, and a column that appeared and vanished with a
                        // settings toggle would lose whatever column order the
                        // person had arranged.
                        appliesTo: (schema: ContentTypeDetail) =>
                            !!schema.publishable,
                        // One request for the whole page, and **only when the
                        // column is switched on**. Extension columns are hidden
                        // by default and this hook runs regardless, so ignoring
                        // `isVisible` would fetch on every page of every list
                        // for numbers nobody is looking at.
                        useRowsData: (
                            entries: EntryRecord[],
                            schema: ContentTypeDetail,
                            workspaceId: string,
                            isVisible: boolean
                        ) =>
                            useReviewStatusByEntry(
                                workspaceId,
                                schema.name,
                                entries.map((entry: EntryRecord) => entry.id),
                                isVisible
                            ),
                        Cell: ReviewColumnCell
                    }
                ]
            },
            {
                // `reviewState` in the records list's own filter tree. Saved
                // views and alarms' "Save as rule" both read that tree, so this
                // one contribution reaches all three surfaces.
                slot: RECORDS_FILTER_FIELDS_SLOT,
                items: [
                    {
                        id: 'protection.records.filterFields',
                        useFields: useReviewStateFilterFields
                    }
                ]
            },
            {
                slot: INSIGHTS_WIDGET_SLOT,
                items: [
                    {
                        id: 'insights.protection.reviews',
                        // Beside content's own debts — half of what Insights
                        // reports is work outstanding, and a stalled review is
                        // one more of those.
                        section: INSIGHTS_SECTION_IDS.Content,
                        order: 40,
                        size: 'xs',
                        // Matches the route's own guard, so the card is not
                        // rendered for somebody the request would then refuse.
                        permission: 'content:read',
                        titleId: 'protection.insights.title',
                        defaultTitle: 'Waiting on review',
                        Component: ProtectionInsightsCard
                    }
                ]
            },
            {
                slot: WORKSPACE_SETTINGS_TAB_SLOT,
                items: [
                    {
                        id: 'protection',
                        path: 'protection',
                        labelId: 'protection.settings.tab',
                        defaultLabel: 'Protection',
                        icon: Shield,
                        order: 10,
                        // Administrator-only, and so is the list route it
                        // opens — a member without it is shown no link rather
                        // than a tab that answers 403.
                        permission: 'protection:manage',
                        element: <ProtectionSettings />
                    }
                ]
            }
        ]
    };
}
