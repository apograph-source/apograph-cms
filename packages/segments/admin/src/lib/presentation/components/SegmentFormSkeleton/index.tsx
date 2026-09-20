import { defineMessages, useIntl } from 'react-intl';
import { Skeleton } from '@orthacms/design-system';

const messages = defineMessages({
    loading: {
        id: 'segments.form.skeleton.loading',
        defaultMessage: 'Loading the audience…'
    }
});

/**
 * The audience editor's body while it loads — a label/control pair per field,
 * then the actions row.
 *
 * A **skeleton rather than a spinner**: a form's shape is most of what a reader
 * needs to know before it arrives, and a centred spinner tells them none of it
 * while moving every control once it resolves.
 *
 * Two consumers, hence the top of `components/`: the route's lazy-chunk fallback
 * ({@link SegmentEditorPageSkeleton}) and the edit page's own pending state,
 * where the header above it is already real.
 */
export function SegmentFormSkeleton() {
    const intl = useIntl();

    return (
        <div role="status" className="mt-6">
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div aria-hidden className="flex max-w-2xl flex-col gap-6">
                {[
                    'h-9',
                    'h-9',
                    // The reader-tags field is a textarea, so it is taller.
                    'h-24'
                ].map((height, field) => (
                    <div key={field} className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className={`${height} w-full`} />
                        <Skeleton className="h-3 w-64 max-w-full" />
                    </div>
                ))}
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-24 w-full" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-36" />
                    <Skeleton className="h-9 w-24" />
                </div>
            </div>
        </div>
    );
}
