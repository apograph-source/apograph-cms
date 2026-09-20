import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, UserPlus } from 'lucide-react';
import { Button, toast } from '@orthacms/design-system';
import type { EntryReview } from '../../../../domain/types';
import {
    useApprove,
    type EntryReviewScope
} from '../../../../application/hooks';
import { RequestReviewDialog } from '../RequestReviewDialog';

const messages = defineMessages({
    requestReview: {
        id: 'protection.actions.requestReview',
        defaultMessage: 'Request review'
    },
    changeReviewers: {
        id: 'protection.actions.changeReviewers',
        defaultMessage: 'Change reviewers'
    },
    approve: { id: 'protection.actions.approve', defaultMessage: 'Approve' },
    approvedToast: {
        id: 'protection.actions.approvedToast',
        defaultMessage: 'Approved — {given} of {required} on this version.'
    },
    wroteHead: {
        id: 'protection.actions.wroteHead',
        defaultMessage:
            'You wrote this version, so somebody else has to approve it.'
    },
    failed: {
        id: 'protection.actions.failed',
        defaultMessage: 'That did not go through. Try again.'
    }
});

/**
 * The controls under the reviewer list: ask people, and approve.
 *
 * **Approve disappears once you have approved this version.** Your row already
 * carries the green check, and a button that does nothing further is noise. It
 * comes back after a save, because your approval is then on a version nobody is
 * publishing.
 *
 * The person who wrote the head revision is told **in a sentence** why they
 * cannot approve it — not shown a disabled button, which explains nothing to
 * anybody and nothing at all to a screen reader.
 *
 * **Request review opens a picker**, and on an entry that already has a request
 * the same button reads "Change reviewers": the request route replaces who is
 * asked. There are no notes and no "request changes" — a reviewer who is not
 * satisfied simply does not approve.
 */
export function ReviewActions({
    scope,
    review,
    canApprove,
    canRequest
}: {
    scope: EntryReviewScope;
    review: EntryReview;
    /** Whether the signed-in person holds `content:approve`. */
    canApprove: boolean;
    /** Whether the signed-in person holds `content:update`, which asking takes. */
    canRequest: boolean;
}) {
    const intl = useIntl();
    const [picking, setPicking] = useState(false);
    const approve = useApprove(scope);

    const canVote =
        canApprove && !review.callerWroteHead && !review.callerApprovedHead;
    const toldWhy = canApprove && review.callerWroteHead;

    if (!canVote && !canRequest && !toldWhy) return null;

    return (
        <div className="flex flex-col gap-2">
            {toldWhy ? (
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.wroteHead)}
                </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
                {canVote ? (
                    <Button
                        type="button"
                        size="sm"
                        disabled={approve.isPending}
                        onClick={() =>
                            approve.mutate(
                                {
                                    typeName: scope.typeName,
                                    entryId: scope.entryId
                                },
                                {
                                    onSuccess: () =>
                                        toast.success(
                                            intl.formatMessage(
                                                messages.approvedToast,
                                                {
                                                    given: review.given + 1,
                                                    required: review.required
                                                }
                                            )
                                        ),
                                    onError: () =>
                                        toast.error(
                                            intl.formatMessage(messages.failed)
                                        )
                                }
                            )
                        }
                    >
                        <Check aria-hidden />
                        {intl.formatMessage(messages.approve)}
                    </Button>
                ) : null}

                {canRequest ? (
                    <Button
                        type="button"
                        size="sm"
                        variant={canVote ? 'outline' : 'default'}
                        onClick={() => setPicking(true)}
                    >
                        <UserPlus aria-hidden />
                        {intl.formatMessage(
                            review.request
                                ? messages.changeReviewers
                                : messages.requestReview
                        )}
                    </Button>
                ) : null}
            </div>

            {canRequest ? (
                <RequestReviewDialog
                    open={picking}
                    onOpenChange={setPicking}
                    scope={scope}
                    currentReviewerIds={review.request?.reviewerIds ?? []}
                />
            ) : null}
        </div>
    );
}
