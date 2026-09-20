import { defineMessages, useIntl } from 'react-intl';
import { Image } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    Skeleton,
    TopBar,
    TopBarIcon
} from '@orthacms/design-system';

/** Intl descriptors for the media-library skeleton, co-located here. */
const messages = defineMessages({
    nav: {
        id: 'media.topbar.nav',
        defaultMessage: 'Breadcrumb'
    },
    root: {
        id: 'media.topbar.root',
        defaultMessage: 'Media Library'
    },
    loading: {
        id: 'media.skeleton.loading',
        defaultMessage: 'Loading media library…'
    }
});

/** A placeholder folder row in the nav rail. */
function FolderRowSkeleton() {
    return (
        <div className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-6 shrink-0" />
        </div>
    );
}

/**
 * Full-page placeholder for the Media Library's lazy-route `Suspense` fallback,
 * mounted in the workspace shell at `/workspaces/:id/media/*`.
 *
 * The bar is **real**, not a skeleton: it is the page's identity, and it is
 * where the sidebar-reveal trigger lives when the app sidebar is collapsed, so
 * it must paint before the chunk lands. It composes the `TopBar` primitives
 * here rather than reusing {@link MediaTopBar} — that module reaches into the
 * library's own internals and pulls ~19 kB into the eager graph, which is a
 * poor trade for a placeholder. What it renders is the trail the real bar shows
 * at the root folder, so nothing moves when the page takes over; the folder
 * crumbs arrive with the data that names them.
 *
 * The body mirrors the page's two-column shell — the folder rail and the asset
 * grid — so the columns don't jump into place on swap.
 */
export function MediaLibraryPageSkeleton() {
    const intl = useIntl();

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TopBar>
                <TopBarIcon className="bg-teal-soft text-teal-soft-foreground">
                    <Image />
                </TopBarIcon>
                <Breadcrumb aria-label={intl.formatMessage(messages.nav)}>
                    <BreadcrumbList className="flex-nowrap font-medium">
                        <BreadcrumbItem className="min-w-0 whitespace-nowrap">
                            <BreadcrumbPage className="flex min-w-0 items-center font-medium">
                                {intl.formatMessage(messages.root)}
                            </BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </TopBar>

            <div
                role="status"
                className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row"
            >
                <span className="sr-only">
                    {intl.formatMessage(messages.loading)}
                </span>

                <div
                    aria-hidden
                    className="hidden h-full w-60 shrink-0 flex-col overflow-hidden lg:flex lg:border-r"
                >
                    <div className="flex items-center gap-2 p-2">
                        <Skeleton className="size-4 shrink-0 rounded" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                    <div className="flex flex-col gap-0.5 px-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <FolderRowSkeleton key={index} />
                        ))}
                    </div>
                </div>

                <div aria-hidden className="min-w-0 flex-1 overflow-hidden">
                    <div className="p-4 sm:p-6">
                        <div className="mb-4 flex flex-col gap-2">
                            <Skeleton className="h-8 w-48" />
                            <Skeleton className="h-4 w-72 max-w-full" />
                        </div>

                        <div className="mb-4 flex flex-wrap items-center gap-3">
                            <Skeleton className="h-9 w-full sm:max-w-[320px]" />
                            <Skeleton className="h-9 w-32" />
                            <Skeleton className="ml-auto h-9 w-28" />
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {Array.from({ length: 10 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="flex flex-col gap-2 rounded-xl border p-2"
                                >
                                    <Skeleton className="aspect-square w-full rounded-lg" />
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
