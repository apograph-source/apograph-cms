import { defineMessages, useIntl } from 'react-intl';
import { Sparkles } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    Container,
    Skeleton,
    TopBar,
    TopBarIcon
} from '@orthacms/design-system';

// The product is **Ortha AI**; the code keeps `copilot`. See the naming note in
// `docs/design/copilot.md`.
const messages = defineMessages({
    root: {
        id: 'copilot.agents.topbar.root',
        defaultMessage: 'Ortha AI'
    },
    loadingAgents: {
        id: 'copilot.agents.skeleton.loading',
        defaultMessage: 'Loading Ortha AI…'
    },
    loadingSkills: {
        id: 'copilot.skills.skeleton.loading',
        defaultMessage: 'Loading skills…'
    }
});

/**
 * The Agents view's bar, as the skeleton renders it: icon tile and root crumb.
 *
 * Real chrome rather than a shimmer — it is the page's identity, and it is what
 * hosts the sidebar-reveal trigger when the app sidebar is collapsed, so it has
 * to paint before the chunk lands. It composes `TopBar` directly instead of
 * reusing {@link AgentsTopBar}, which reads the open thread's title from the
 * conversations query: the leaf crumb is a property of data, so the skeleton
 * shows the root and lets the page fill the rest in.
 */
function AgentsBarSkeleton() {
    const intl = useIntl();

    return (
        <TopBar>
            <TopBarIcon className="bg-primary/10 text-primary">
                <Sparkles />
            </TopBarIcon>
            <Breadcrumb className="min-w-0 overflow-hidden">
                <BreadcrumbList className="flex-nowrap font-medium">
                    <BreadcrumbItem className="min-w-0 whitespace-nowrap">
                        <BreadcrumbPage className="flex min-w-0 items-center truncate font-medium">
                            {intl.formatMessage(messages.root)}
                        </BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>
        </TopBar>
    );
}

/**
 * Full-page placeholder for the Agents view's lazy-route `Suspense` fallback,
 * mounted in the workspace shell at `/workspaces/:id/agents/*`.
 *
 * Below the bar it mirrors the view's two regions — the thread rail and the
 * conversation column with its composer pinned to the bottom — so the chat
 * surface doesn't assemble itself in front of the user when the chunk arrives.
 * The rail is `hidden md:flex` exactly as the real one is: below `md` it has no
 * column of its own and lives behind the bar's sheet.
 */
export function AgentsPageSkeleton() {
    const intl = useIntl();

    return (
        <>
            <AgentsBarSkeleton />
            {/* Same `min-h-0` bounded row the loaded view uses, so the rail
                and the thread land exactly where the placeholder left them. */}
            <div role="status" className="flex min-h-0 min-w-0 flex-1">
                <span className="sr-only">
                    {intl.formatMessage(messages.loadingAgents)}
                </span>

                <div
                    aria-hidden
                    className="bg-muted/30 hidden w-72 shrink-0 flex-col gap-2 border-r p-3 md:flex"
                >
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-8 w-full" />
                    {Array.from({ length: 7 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full" />
                    ))}
                </div>

                <div
                    aria-hidden
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
                        <Skeleton className="h-7 w-64" />
                        <Skeleton className="h-4 w-full max-w-md" />
                        <div className="mt-auto flex flex-col gap-2">
                            <Skeleton className="h-24 w-full rounded-xl" />
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-7 w-24 rounded-full" />
                                <Skeleton className="h-7 w-20 rounded-full" />
                                <Skeleton className="ml-auto size-8 rounded-full" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

/**
 * Full-page placeholder for the Skills page's lazy-route `Suspense` fallback,
 * at `/workspaces/:id/agents/skills`.
 *
 * The page renders no bar of its own — it is a plain `Container` under a back
 * link — so this sketches the whole thing. The three rows below the header are
 * the same shape {@link SkillsPage} shows for its own `isLoading` state, which
 * makes the chunk boundary invisible: the placeholder simply stays put while
 * the list query resolves behind it.
 */
export function SkillsPageSkeleton() {
    const intl = useIntl();

    return (
        <Container className="flex flex-col gap-6 py-8" role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loadingSkills)}
            </span>

            <div
                aria-hidden
                className="flex flex-wrap items-start justify-between gap-3"
            >
                <div className="flex max-w-2xl flex-col gap-1">
                    <Skeleton className="mb-1 h-8 w-36" />
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="mt-1 h-4 w-full max-w-xl" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
                <Skeleton className="h-9 w-28" />
            </div>

            <div aria-hidden className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </Container>
    );
}
