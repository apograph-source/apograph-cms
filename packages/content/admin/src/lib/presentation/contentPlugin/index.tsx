import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { COMMAND_SLOT } from '@orthacms/shell-admin';
import {
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_SECTION_SLOT
} from '@orthacms/workspaces-admin';
import {
    INSIGHTS_SECTION_IDS,
    INSIGHTS_WIDGET_SLOT
} from '@orthacms/insights-admin';
import { CONTENT_READ, CONTENT_SEGMENT } from '../../domain/constants';
import { ContentLibraryPageSkeleton } from '../components/ContentLibrarySkeleton';
import { ContentNavSection } from '../components/ContentNavSection';
import { ContentTypeCommands } from '../components/ContentTypeCommands';
import { ContentEntriesStat } from '../components/ContentEntriesStat';
import { ContentPublishedStat } from '../components/ContentPublishedStat';
import { ContentDraftsStat } from '../components/ContentDraftsStat';
import { StaleEntriesWidget } from '../components/StaleEntriesWidget';
import { ContentPipelineWidget } from '../components/ContentPipelineWidget';
import { PublishingVelocityWidget } from '../components/PublishingVelocityWidget';
import { UnshippedChangesWidget } from '../components/UnshippedChangesWidget';
import { ContentPunchcardWidget } from '../components/ContentPunchcardWidget';

const ContentLibraryPage = lazy(() =>
    import('../pages/ContentLibraryPage').then((module) => ({
        default: module.ContentLibraryPage
    }))
);

/**
 * Admin-side content plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config has a home.
 */
export type ContentAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side Content Library plugin. It lives **strictly inside a
 * workspace**: it contributes no top-level route and no top-toolbar nav entry,
 * only the **Content** section of the workspace sidebar (the content-type nav +
 * ⌘K search, `WORKSPACE_SECTION_SLOT`) + its `content/*` route (the
 * lowest-order route, so the workspace base lands here). Both go into the
 * workspace shell's slots (owned by `@orthacms/workspaces-admin`), so register
 * it after `WorkspacesPlugin()`.
 */
export function ContentPlugin(): ContentAdminPlugin {
    return {
        name: 'content',
        slots: [
            {
                // Insights widgets. Content owns the data behind them, so it
                // owns the cards — the Insights plugin ships the page, the
                // grid and the card shell, and knows nothing about entries.
                slot: INSIGHTS_WIDGET_SLOT,
                items: [
                    {
                        id: 'insights.content.entries',
                        section: INSIGHTS_SECTION_IDS.Overview,
                        order: 10,
                        size: 'xs',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.entries.label',
                        defaultTitle: 'Entries',
                        Component: ContentEntriesStat
                    },
                    {
                        id: 'insights.content.published',
                        section: INSIGHTS_SECTION_IDS.Overview,
                        order: 20,
                        size: 'xs',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.published.label',
                        defaultTitle: 'Published',
                        Component: ContentPublishedStat
                    },
                    {
                        id: 'insights.content.drafts',
                        section: INSIGHTS_SECTION_IDS.Overview,
                        order: 30,
                        size: 'xs',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.drafts.label',
                        defaultTitle: 'Drafts',
                        Component: ContentDraftsStat
                    },
                    {
                        id: 'insights.content.stale',
                        section: INSIGHTS_SECTION_IDS.Content,
                        order: 10,
                        size: 'md',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.stale.title',
                        defaultTitle: 'Gone quiet',
                        Component: StaleEntriesWidget
                    },
                    {
                        id: 'insights.content.pipeline',
                        section: INSIGHTS_SECTION_IDS.Content,
                        order: 20,
                        size: 'md',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.pipeline.title',
                        defaultTitle: 'Draft and published, by type',
                        Component: ContentPipelineWidget
                    },
                    {
                        // `lg` rather than `full` so the unshipped tile below
                        // shares its row — the grid is twelfths, and 8 + 4 is
                        // what makes that one row instead of two.
                        id: 'insights.content.velocity',
                        section: INSIGHTS_SECTION_IDS.Content,
                        order: 30,
                        size: 'lg',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.velocity.title',
                        defaultTitle: 'Publishing velocity',
                        Component: PublishingVelocityWidget
                    },
                    {
                        id: 'insights.content.unshipped',
                        section: INSIGHTS_SECTION_IDS.Content,
                        order: 40,
                        size: 'sm',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.unshipped.title',
                        defaultTitle: 'Waiting to go live',
                        Component: UnshippedChangesWidget
                    },
                    {
                        // Team, not Content: the question it answers is about
                        // the people, even though the data is content's.
                        id: 'insights.content.punchcard',
                        section: INSIGHTS_SECTION_IDS.Team,
                        order: 10,
                        size: 'full',
                        permission: CONTENT_READ,
                        titleId: 'content.insights.punchcard.title',
                        defaultTitle: 'When the work happens',
                        Component: ContentPunchcardWidget
                    }
                ]
            },
            {
                slot: WORKSPACE_SECTION_SLOT,
                items: [
                    {
                        id: 'content.nav',
                        order: 10,
                        Component: ContentNavSection
                    }
                ]
            },
            {
                // Command palette: jump straight to any workspace's content type.
                slot: COMMAND_SLOT,
                items: [
                    {
                        id: 'content.command',
                        order: 20,
                        Component: ContentTypeCommands
                    }
                ]
            },
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        path: `${CONTENT_SEGMENT}/*`,
                        // Lowest order → the workspace's default landing section.
                        order: 10,
                        element: (
                            <Suspense fallback={<ContentLibraryPageSkeleton />}>
                                <ContentLibraryPage />
                            </Suspense>
                        )
                    }
                ]
            }
        ]
    };
}
