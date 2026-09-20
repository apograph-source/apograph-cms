import { defineMessages, useIntl } from 'react-intl';
import {
    EntrySidebarSection,
    type EntrySlotContext
} from '@orthacms/content-admin';
import { useAuth, useHasPermission } from '@orthacms/identity-admin';
import { SkeletonRegion, Skeleton, cn } from '@orthacms/design-system';
import { toneOf } from '../../../domain/types';
import { reviewerRows } from '../../../domain/reviewerRows';
import { reviewScopeOf, useEntryReview } from '../../../application/hooks';
import { ReviewerRow } from './ReviewerRow';
import { ReviewActions } from './ReviewActions';

const messages = defineMessages({
    title: { id: 'protection.review.title', defaultMessage: 'Review' },
    count: {
        id: 'protection.review.count',
        defaultMessage: '{given} of {required}'
    },
    description: {
        id: 'protection.review.description',
        defaultMessage:
            'This type is protected: publishing needs {required, plural, one {# approval} other {# approvals}} on the current version.'
    },
    ready: {
        id: 'protection.review.ready',
        defaultMessage:
            'Enough approvals on this version — Publish is unlocked.'
    },
    none: {
        id: 'protection.review.none',
        defaultMessage: 'Nobody has been asked to review this yet.'
    },
    loading: {
        id: 'protection.review.loading',
        defaultMessage: 'Loading review state'
    },
    failed: {
        id: 'protection.review.failed',
        defaultMessage: 'The review state could not be loaded.'
    }
});

/**
 * The Properties rail's **Review** block.
 *
 * Renders `EntrySidebarSection` rather than a card of its own: the rail is one
 * flat surface divided by rules, and a contribution with its own border would
 * be the only floating box in it. It lands after Publish gate → Details →
 * Revisions because slot widgets render last — which reads correctly, since
 * review is the gate *after* those.
 *
 * It renders **nothing** on an unprotected type, on a create form, and on a
 * non-publishable one. With no rule the feature is inert server-side, and a
 * block describing a requirement that does not exist would be an invention.
 *
 * It lists **people**, not votes: everybody asked, then anybody else who
 * approved, each with a green check once they approved the current version or
 * a yellow dot while that is pending (`reviewerRows`).
 *
 * The heading's count is the same "{given} of {required}" the chip and the
 * publish button say, and it is **text**: the tone beside it is a second
 * signal, never the only one.
 */
export function ReviewSection(context: EntrySlotContext) {
    const intl = useIntl();
    const auth = useAuth();
    const canApprove = useHasPermission('content:approve');
    const canRequest = useHasPermission('content:update');
    const scope = reviewScopeOf(context);
    const { data, isPending, isError } = useEntryReview(scope);

    if (!scope) return null;

    if (isPending) {
        return (
            <EntrySidebarSection title={intl.formatMessage(messages.title)}>
                <SkeletonRegion label={intl.formatMessage(messages.loading)}>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-4 w-24" />
                </SkeletonRegion>
            </EntrySidebarSection>
        );
    }

    // A failed read is its own state, never the empty one: "nobody has reviewed
    // this" is a claim about the entry, and saying it when the truth is "we
    // could not ask" would tell somebody their draft is unreviewed when it may
    // be approved.
    if (isError || !data) {
        return (
            <EntrySidebarSection title={intl.formatMessage(messages.title)}>
                <p className="text-sm text-destructive">
                    {intl.formatMessage(messages.failed)}
                </p>
            </EntrySidebarSection>
        );
    }

    if (!data.protected) return null;

    const tone = toneOf(data);
    const rows = reviewerRows(data);

    return (
        <EntrySidebarSection
            title={intl.formatMessage(messages.title)}
            action={
                <span
                    className={cn(
                        'text-xs font-medium tabular-nums',
                        tone === 'satisfied' && 'text-success-soft-foreground',
                        tone === 'partial' && 'text-warning-soft-foreground',
                        tone === 'blocked' && 'text-destructive'
                    )}
                >
                    {intl.formatMessage(messages.count, {
                        given: data.given,
                        required: data.required
                    })}
                </span>
            }
            description={intl.formatMessage(
                tone === 'satisfied' ? messages.ready : messages.description,
                { required: data.required }
            )}
        >
            <div className="flex flex-col gap-3">
                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.none)}
                    </p>
                ) : (
                    <ul className="flex flex-col gap-3">
                        {rows.map((row) => (
                            <ReviewerRow
                                key={row.userId}
                                row={row}
                                currentUserId={auth.user?.id}
                            />
                        ))}
                    </ul>
                )}
                <ReviewActions
                    scope={scope}
                    review={data}
                    canApprove={canApprove}
                    canRequest={canRequest}
                />
            </div>
        </EntrySidebarSection>
    );
}
