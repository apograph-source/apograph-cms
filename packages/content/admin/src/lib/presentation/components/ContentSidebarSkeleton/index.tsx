import { Skeleton } from '@orthacms/design-system';

/**
 * Loading placeholder for the content sidebar region: a header block with a
 * search bar and two groups of rows. Mirrors the flat chrome of
 * {@link ContentSidebar} so the layout doesn't shift when the real list resolves.
 */
export function ContentSidebarSkeleton() {
    return (
        <div
            aria-hidden
            className="hidden h-full w-60 shrink-0 flex-col overflow-hidden md:flex"
        >
            <div className="flex flex-col gap-2 p-2">
                <Skeleton className="mx-2 h-5 w-20" />
                <Skeleton className="h-8 w-full" />
            </div>
            <div className="flex flex-1 flex-col gap-4 p-2">
                {[0, 1].map((group) => (
                    <div key={group} className="flex flex-col gap-1.5">
                        <Skeleton className="mx-2 h-4 w-24" />
                        {[0, 1, 2].map((row) => (
                            <Skeleton key={row} className="h-7 w-full" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
