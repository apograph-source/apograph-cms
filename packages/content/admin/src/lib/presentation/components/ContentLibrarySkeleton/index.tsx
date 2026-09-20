import { defineMessages, useIntl } from 'react-intl';
import { Library } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    Skeleton,
    TopBar,
    TopBarIcon
} from '@orthacms/design-system';

/** Intl descriptors for the content-library skeleton, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'content.library.skeleton.heading',
        defaultMessage: 'Loading content types'
    },
    nav: {
        id: 'content.topbar.nav',
        defaultMessage: 'Breadcrumb'
    },
    root: {
        id: 'content.topbar.root',
        defaultMessage: 'Content'
    },
    loading: {
        id: 'content.skeleton.loading',
        defaultMessage: 'Loading content…'
    }
});

/**
 * Full-page placeholder for the Content Library's lazy-route `Suspense`
 * fallback, mounted in the workspace shell's work area at
 * `/workspaces/:id/content/*`.
 *
 * The bar is **real**, not a skeleton — it is the page's identity and, when the
 * app sidebar is collapsed, the only place the reveal trigger lives, so it has
 * to be there from the first paint rather than popping in once the chunk
 * resolves. It composes the `TopBar` primitives directly instead of reusing
 * {@link ContentTopBar}: that component needs the workspace's granted content
 * types, which are exactly what has not loaded yet. Only the root crumb is
 * shown; the type and record crumbs arrive with the data that names them.
 *
 * The body sketches the welcome/type view under it. The outer pane repeats
 * {@link ContentLibraryPage}'s own `ContentPane` classes so the shell's flex
 * chain measures the same before and after the swap.
 */
export function ContentLibraryPageSkeleton() {
    const intl = useIntl();

    return (
        // `aria-busy` marks this as a loading placeholder so the host's route
        // announcer waits past the sr-only "Loading content types" heading
        // below and reads the settled page name instead (see `RouteAnnouncer`).
        <div
            aria-busy="true"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
        >
            {/* The page's `<h1>`, visually hidden. A lazy route's `Suspense`
                fallback is a whole page with no heading at all until the real
                one mounts — and it is the state a slow connection sits in
                longest, so it is the one most likely to be navigated by heading
                (`ORT-167`).

                It names the **state**, not the page, and deliberately: an `<h1>`
                repeating the loaded page's would put two identically-named
                level-one headings on screen across the swap, which is ambiguous
                to a reader and to anything locating by heading. "Loading X" is
                also the more useful thing to hear here. */}
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <TopBar>
                <TopBarIcon className="bg-brand-soft text-brand-soft-foreground">
                    <Library />
                </TopBarIcon>
                <Breadcrumb aria-label={intl.formatMessage(messages.nav)}>
                    <BreadcrumbList className="flex-nowrap font-medium">
                        <BreadcrumbItem className="min-w-0 whitespace-nowrap">
                            <BreadcrumbPage className="flex min-w-0 items-center truncate font-medium">
                                {intl.formatMessage(messages.root)}
                            </BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </TopBar>

            <div role="status" className="p-4 sm:p-6">
                <span className="sr-only">
                    {intl.formatMessage(messages.loading)}
                </span>
                <div aria-hidden className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-7 w-56" />
                        <Skeleton className="h-4 w-80 max-w-full" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Skeleton className="h-9 w-full sm:max-w-[320px]" />
                        <Skeleton className="h-9 w-32" />
                        <Skeleton className="ml-auto h-9 w-28" />
                    </div>
                    <div className="rounded-xl border">
                        <div className="flex items-center gap-4 border-b px-4 py-3">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <Skeleton key={index} className="h-4 w-24" />
                            ))}
                        </div>
                        {Array.from({ length: 8 }).map((_, row) => (
                            <div
                                key={row}
                                className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
                            >
                                {Array.from({ length: 4 }).map((_, cell) => (
                                    <Skeleton key={cell} className="h-4 w-24" />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
