import { defineMessages, useIntl } from 'react-intl';
import { Skeleton, SkeletonRegion } from '@orthacms/design-system';

/** How many placeholder rows the loading state renders. */
const ROWS = 8;

/** Intl descriptors for {@link CollectionRecordsSkeleton}, co-located. */
const messages = defineMessages({
    loading: {
        id: 'content.records.skeleton.loading',
        defaultMessage: 'Loading records…'
    }
});

/**
 * The records table loading state: a bordered card of shimmer rows that stands
 * in for the table while the schema and the first page of entries resolve, so
 * the layout doesn't jump when data lands.
 *
 * Wrapped in a {@link SkeletonRegion}, so the transition into loading is
 * announced once. It used to be bare placeholder blocks with no live region at
 * all — the page went silent on every navigation into a collection and a
 * screen-reader user could not tell whether it was working or stuck
 * (`ORT-161`).
 */
export function CollectionRecordsSkeleton() {
    const intl = useIntl();

    return (
        <SkeletonRegion label={intl.formatMessage(messages.loading)}>
            <div className="rounded-xl border">
                <div className="flex items-center gap-4 border-b px-4 py-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton key={index} className="h-4 w-24" />
                    ))}
                </div>
                {Array.from({ length: ROWS }).map((_, row) => (
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
        </SkeletonRegion>
    );
}
