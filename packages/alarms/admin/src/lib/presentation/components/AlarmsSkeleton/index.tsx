import { defineMessages, useIntl } from 'react-intl';
import { Skeleton, SkeletonRegion } from '@orthacms/design-system';

const messages = defineMessages({
    loading: {
        id: 'alarms.skeleton.loading',
        defaultMessage: 'Loading alarms…'
    }
});

/**
 * The alarms page's loading shape — also the route's `Suspense` fallback, so
 * the code-split chunk and the first request present as one wait rather than a
 * spinner followed by a second layout shift.
 */
export function AlarmsSkeleton() {
    const intl = useIntl();
    return (
        <SkeletonRegion label={intl.formatMessage(messages.loading)}>
            <div className="flex flex-col gap-4 p-6">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-9 w-72" />
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3, 4].map((row) => (
                        <Skeleton key={row} className="h-16 w-full" />
                    ))}
                </div>
            </div>
        </SkeletonRegion>
    );
}
