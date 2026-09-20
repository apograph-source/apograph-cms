import { defineMessages, useIntl } from 'react-intl';
import { ShieldCheck } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { Container, Skeleton } from '@orthacms/design-system';
import { SegmentFormSkeleton } from '../SegmentFormSkeleton';

const messages = defineMessages({
    heading: {
        id: 'segments.editor.skeleton.heading',
        defaultMessage: 'Loading the audience editor'
    },
    directory: { id: 'segments.editor.directory', defaultMessage: 'Segments' }
});

/**
 * The `Suspense` fallback for `/segments/new` and `/segments/:segmentId`, while
 * the editor's chunk loads.
 *
 * Same two rules as {@link SegmentsPageSkeleton}: the bar is real (it is the way
 * back out of a page that has not arrived yet), and the `<h1>` is visually
 * hidden and names the state rather than the page.
 *
 * The trail keeps **both** crumbs, the second as a bar: whether this is "New
 * audience" or "Edit audience" is in the chunk that has not loaded, and guessing
 * from the URL would print a uuid. Dropping it instead would leave the bar a
 * crumb short and shift the whole trail the moment the chunk resolved.
 */
export function SegmentEditorPageSkeleton() {
    const intl = useIntl();

    return (
        <div aria-busy="true">
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <PageTopBar
                icon={ShieldCheck}
                crumbs={[
                    {
                        key: 'segments',
                        label: intl.formatMessage(messages.directory),
                        to: '/segments'
                    },
                    {
                        key: 'editor',
                        label: (
                            <Skeleton
                                aria-hidden
                                className="h-4 w-28 align-middle"
                            />
                        )
                    }
                ]}
            />
            <Container>
                <div aria-hidden className="flex flex-col gap-2">
                    <Skeleton className="h-7 w-48" />
                    <Skeleton className="h-4 w-96 max-w-full" />
                </div>
                <SegmentFormSkeleton />
            </Container>
        </div>
    );
}
