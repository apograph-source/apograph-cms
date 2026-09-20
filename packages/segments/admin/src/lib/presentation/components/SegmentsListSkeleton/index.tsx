import { defineMessages, useIntl } from 'react-intl';
import { Skeleton } from '@orthacms/design-system';

const messages = defineMessages({
    loading: {
        id: 'segments.list.skeleton.loading',
        defaultMessage: 'Loading audiences…'
    }
});

/** How many placeholder rows to draw. Matches the directory's default page. */
const ROWS = 6;

/**
 * The directory's body while it loads — the search box, the table and its pager,
 * sketched in place.
 *
 * A **skeleton rather than a spinner**, and the difference is not decoration: a
 * spinner says "something is happening" and takes the reader's eye to the middle
 * of an otherwise empty screen; a skeleton says *what* is coming and leaves the
 * layout where it will be, so nothing jumps when the rows arrive. It is also the
 * only one of the two that is honest about the page being a table.
 *
 * Two consumers, which is why it sits at the top of `components/`: the route's
 * lazy-chunk fallback ({@link SegmentsPageSkeleton}) and the page's own pending
 * state, where the header above it is already real.
 *
 * The bars are `aria-hidden` under one `role="status"` — a screen reader gets
 * one sentence, not sixty empty boxes.
 */
export function SegmentsListSkeleton() {
    const intl = useIntl();

    return (
        <div role="status" className="mt-4">
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div aria-hidden className="flex flex-col gap-4">
                <Skeleton className="h-9 w-64 max-w-full" />
                <div className="overflow-hidden rounded-xl border">
                    <div className="flex items-center gap-4 border-b px-4 py-3">
                        {Array.from({ length: 4 }).map((_, column) => (
                            <Skeleton key={column} className="h-4 w-24" />
                        ))}
                    </div>
                    {Array.from({ length: ROWS }).map((_, row) => (
                        <div
                            key={row}
                            className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0"
                        >
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="ml-auto size-8 rounded-md" />
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-8 w-44" />
                </div>
            </div>
        </div>
    );
}
