import { defineMessages, useIntl } from 'react-intl';
import { BarChart3 } from 'lucide-react';
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

/** Intl descriptors for the insights skeleton, co-located here. */
const messages = defineMessages({
    title: {
        id: 'insights.page.title',
        defaultMessage: 'Insights'
    },
    loading: {
        id: 'insights.skeleton.loading',
        defaultMessage: 'Loading insights…'
    }
});

/**
 * One placeholder band: a section rule over a row of widget cards. The spans are
 * whole literal class strings, mirroring `InsightsSectionBand`'s `SIZE_SPAN` —
 * Tailwind scans source text and never emits an interpolated class name.
 */
function BandSkeleton({ cards }: { cards: string[] }) {
    return (
        <div className="flex flex-col gap-3">
            <div className="border-b pb-1">
                <Skeleton className="h-3 w-32" />
            </div>
            <div className="grid grid-cols-12 gap-4">
                {cards.map((span, index) => (
                    <div key={index} className={span}>
                        <div className="flex h-40 flex-col gap-3 rounded-xl border p-4">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-40 max-w-full" />
                            <Skeleton className="mt-auto h-16 w-full" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Full-page placeholder for the Insights lazy-route `Suspense` fallback,
 * mounted in the workspace shell at `/workspaces/:id/insights`.
 *
 * The bar and the heading are **real**, not skeletons — they are the page's
 * identity, and the bar hosts the sidebar-reveal trigger when the app sidebar
 * is collapsed, so both have to paint before the chunk lands. The bar is
 * composed from the `TopBar` primitives here rather than imported from
 * {@link InsightsPage}, which writes them inline and is the module being
 * loaded. The subtitle names the workspace, so it waits with the widgets: the
 * heading block reserves its line either way and nothing reflows on swap.
 *
 * The bands below are a sketch, not a count — the real dashboard's widgets come
 * from whichever plugins are installed, so the placeholder shows a plausible
 * two-band grid rather than pretending to know.
 */
export function InsightsPageSkeleton() {
    const intl = useIntl();

    return (
        <>
            <TopBar>
                <TopBarIcon className="bg-warning-soft text-warning-soft-foreground">
                    <BarChart3 />
                </TopBarIcon>
                <Breadcrumb>
                    <BreadcrumbList className="font-medium">
                        <BreadcrumbItem>
                            <BreadcrumbPage className="font-medium">
                                {intl.formatMessage(messages.title)}
                            </BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </TopBar>

            <Container className="flex flex-col gap-6 py-8" role="status">
                <span className="sr-only">
                    {intl.formatMessage(messages.loading)}
                </span>

                <header className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                        {intl.formatMessage(messages.title)}
                    </h1>
                    <Skeleton
                        aria-hidden
                        className="mt-1 h-4 w-80 max-w-full"
                    />
                </header>

                <div aria-hidden className="flex flex-col gap-6">
                    <BandSkeleton
                        cards={[
                            'col-span-12 md:col-span-6 lg:col-span-4',
                            'col-span-12 md:col-span-6 lg:col-span-4',
                            'col-span-12 md:col-span-6 lg:col-span-4'
                        ]}
                    />
                    <BandSkeleton
                        cards={[
                            'col-span-12 lg:col-span-6',
                            'col-span-12 lg:col-span-6'
                        ]}
                    />
                </div>
            </Container>
        </>
    );
}
