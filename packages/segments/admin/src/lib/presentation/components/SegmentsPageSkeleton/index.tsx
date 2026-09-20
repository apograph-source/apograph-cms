import { defineMessages, useIntl } from 'react-intl';
import { ShieldCheck } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { Container, Skeleton } from '@orthacms/design-system';
import { SegmentsListSkeleton } from '../SegmentsListSkeleton';

const messages = defineMessages({
    heading: {
        id: 'segments.page.skeleton.heading',
        defaultMessage: 'Loading segments'
    },
    title: { id: 'segments.page.title', defaultMessage: 'Segments' }
});

/**
 * The `/segments` route's `Suspense` fallback, while its chunk loads.
 *
 * **The bar is real, not a skeleton.** It is the page's identity and its way
 * back, and both are known before a byte of the chunk arrives — a bar that
 * popped in on resolve would be the one thing on screen that moved.
 *
 * **The `<h1>` is visually hidden and names the _state_.** A lazy route's
 * fallback is a whole page with no heading at all until the real one mounts, and
 * it is the state a slow connection sits in longest — so it is the one most
 * likely to be navigated by heading. Naming the state rather than the page keeps
 * two identically-named level-one headings off the screen across the swap, and
 * "Loading segments" is the more useful thing to hear anyway.
 */
export function SegmentsPageSkeleton() {
    const intl = useIntl();

    return (
        // `aria-busy` marks this a placeholder, so the host's route announcer
        // waits past the sr-only heading below and reads the settled page name.
        <div aria-busy="true">
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <PageTopBar
                icon={ShieldCheck}
                crumbs={[
                    {
                        key: 'segments',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                <div aria-hidden className="flex flex-col gap-2">
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-4 w-96 max-w-full" />
                </div>
                <SegmentsListSkeleton />
            </Container>
        </div>
    );
}
