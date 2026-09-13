import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    ContainerHeader,
    SegmentedControl,
    SegmentedControlCount,
    SegmentedControlItem,
    Skeleton,
    SkeletonRegion
} from '@apograph/design-system';
import { useAuth } from '@apograph/identity-admin';
import { PageTopBar } from '@apograph/shell-admin';
import { useCurrentWorkspace } from '@apograph/workspaces-admin';
import { ShieldCheck } from 'lucide-react';
import { useReviewQueue } from '../../../application/hooks';
import { splitQueue } from '../../../domain/types';
import { ReviewQueueTable } from '../../components/ReviewQueueTable';

const messages = defineMessages({
    title: { id: 'protection.reviews.title', defaultMessage: 'Reviews' },
    crumb: { id: 'protection.reviews.crumb', defaultMessage: 'Reviews' },
    subtitle: {
        id: 'protection.reviews.subtitle',
        defaultMessage:
            'Open review requests across every content type in this workspace.'
    },
    tabsLabel: {
        id: 'protection.reviews.tabsLabel',
        defaultMessage: 'Which requests to show'
    },
    tabWaiting: {
        id: 'protection.reviews.tabWaiting',
        defaultMessage: 'Waiting on me'
    },
    tabMine: {
        id: 'protection.reviews.tabMine',
        defaultMessage: 'My requests'
    },
    loading: {
        id: 'protection.reviews.loading',
        defaultMessage: 'Loading review requests'
    },
    failed: {
        id: 'protection.reviews.failed',
        defaultMessage:
            'The review queue could not be loaded, so this list may be incomplete. Reload the page to try again.'
    },
    emptyWaiting: {
        id: 'protection.reviews.emptyWaiting',
        defaultMessage:
            'Nothing is waiting on you. Requests other people open appear here.'
    },
    emptyMine: {
        id: 'protection.reviews.emptyMine',
        defaultMessage:
            'You have not asked anyone to review a record yet. Ask from the record’s Review panel.'
    }
});

/** The two questions the page answers. */
type Tab = 'waiting' | 'mine';

/**
 * The reviewer's queue — **the page without which the feature does not work**.
 *
 * Approvals can be recorded from the moment a rule exists, but until the mail
 * port lands (ORT-207) nothing tells a reviewer that one is wanted. This is the
 * only place somebody finds out, which is why it is a page of its own rather
 * than a saved view of one collection's records list: a saved view can only
 * ever ask about the collection it belongs to, and an ask arrives against
 * whichever type someone happened to be editing.
 *
 * **One request feeds both tabs.** The window is fetched once and split by
 * `splitQueue`, so the two counts cannot disagree with each other, and a person
 * switching tabs pays nothing. The alternative — a request per tab — would also
 * let the same ask appear in both for one render while the second landed.
 */
export function ReviewsPage() {
    const intl = useIntl();
    const auth = useAuth();
    const workspace = useCurrentWorkspace();
    const [tab, setTab] = useState<Tab>('waiting');

    const { data, isPending, isError } = useReviewQueue(
        workspace?.id ?? '',
        {},
        !!workspace
    );

    const { waitingOnMe, mine } = splitQueue(
        data?.items ?? [],
        auth.user?.id ?? ''
    );
    const rows = tab === 'waiting' ? waitingOnMe : mine;

    return (
        <>
            <PageTopBar
                icon={ShieldCheck}
                crumbs={[
                    {
                        key: 'reviews',
                        label: intl.formatMessage(messages.crumb)
                    }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                />

                {isPending ? (
                    <SkeletonRegion
                        label={intl.formatMessage(messages.loading)}
                    >
                        <Skeleton className="h-9 w-64" />
                        <Skeleton className="mt-4 h-32 w-full" />
                    </SkeletonRegion>
                ) : (
                    <>
                        {/* A failed read is its own state, never the empty one.
                            "Nothing is waiting on you" is a claim about the
                            workspace; saying it when the truth is "we could not
                            ask" tells a reviewer they are free when they are
                            not — the one thing this page must never do. */}
                        {isError && (
                            <p
                                role="alert"
                                className="mb-4 text-sm text-destructive"
                            >
                                {intl.formatMessage(messages.failed)}
                            </p>
                        )}

                        <SegmentedControl
                            // `self-start`, so the strip is three tabs rather
                            // than a full-width header band — the same reason
                            // the alarms page states.
                            className="mb-4 self-start"
                            aria-label={intl.formatMessage(messages.tabsLabel)}
                            value={tab}
                            onValueChange={(next) =>
                                next && setTab(next as Tab)
                            }
                        >
                            <SegmentedControlItem value="waiting">
                                {intl.formatMessage(messages.tabWaiting)}
                                <SegmentedControlCount>
                                    {waitingOnMe.length}
                                </SegmentedControlCount>
                            </SegmentedControlItem>
                            <SegmentedControlItem value="mine">
                                {intl.formatMessage(messages.tabMine)}
                                <SegmentedControlCount>
                                    {mine.length}
                                </SegmentedControlCount>
                            </SegmentedControlItem>
                        </SegmentedControl>

                        {/* `data` and a non-empty `rows` are the same
                            condition — the rows come out of it — but the
                            narrowing has to be written down for the threshold
                            the table now takes from it. */}
                        {rows.length && data ? (
                            <ReviewQueueTable
                                items={rows}
                                currentUserId={auth.user?.id}
                                overdueAfterDays={data.overdueAfterDays}
                            />
                        ) : (
                            !isError && (
                                <p className="text-muted-foreground text-sm">
                                    {intl.formatMessage(
                                        tab === 'waiting'
                                            ? messages.emptyWaiting
                                            : messages.emptyMine
                                    )}
                                </p>
                            )
                        )}
                    </>
                )}
            </Container>
        </>
    );
}
