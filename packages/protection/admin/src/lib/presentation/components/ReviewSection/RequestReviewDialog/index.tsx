import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    FieldError,
    Label,
    Skeleton,
    SkeletonRegion,
    Spinner,
    toast
} from '@orthacms/design-system';
import {
    useRequestReview,
    useReviewerCandidates,
    type EntryReviewScope
} from '../../../../application/hooks';

const messages = defineMessages({
    title: {
        id: 'protection.request.title',
        defaultMessage: 'Request review'
    },
    description: {
        id: 'protection.request.description',
        defaultMessage:
            'Choose who should review this entry. Anyone who can approve content may still approve it.'
    },
    legend: {
        id: 'protection.request.legend',
        defaultMessage: 'Reviewers'
    },
    loading: {
        id: 'protection.request.loading',
        defaultMessage: 'Loading who can review'
    },
    failed: {
        id: 'protection.request.failed',
        defaultMessage: 'Could not load who can review.'
    },
    retry: { id: 'protection.request.retry', defaultMessage: 'Try again' },
    nobody: {
        id: 'protection.request.nobody',
        defaultMessage: 'Nobody else in this workspace can approve content yet.'
    },
    pickOne: {
        id: 'protection.request.pickOne',
        defaultMessage: 'Choose at least one reviewer.'
    },
    cancel: { id: 'protection.request.cancel', defaultMessage: 'Cancel' },
    submit: { id: 'protection.request.submit', defaultMessage: 'Request' },
    done: {
        id: 'protection.request.done',
        defaultMessage:
            '{count, plural, one {Review requested from # person.} other {Review requested from # people.}}'
    },
    submitFailed: {
        id: 'protection.request.submitFailed',
        defaultMessage: 'That request did not go through. Try again.'
    }
});

/**
 * Who to ask — the people picker behind **Request review**.
 *
 * It lists exactly who the server accepts: the workspace's other members who
 * hold `content:approve` (`GET …/reviewers`). Names come from the workspace the
 * shell already loaded, so the list costs one request for the ids and none for
 * the people; somebody the roster does not know yet is shown by email rather
 * than dropped.
 *
 * Opening it on an open request starts from the people already asked, so it
 * doubles as "change reviewers" — the request route replaces the set.
 *
 * **No note.** Review messages were removed: the request names people, and the
 * entry and its versions are what they look at.
 *
 * **The submit is not disabled with nobody picked.** Pressing it says why,
 * through a `FieldError` that announces — a dead button explains nothing to a
 * screen reader. The group is a `fieldset` with a `legend`, so the checkboxes
 * are announced as one question.
 */
export function RequestReviewDialog({
    open,
    onOpenChange,
    scope,
    currentReviewerIds
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scope: EntryReviewScope;
    /** Who the open request already names, if there is one. */
    currentReviewerIds: readonly string[];
}) {
    const intl = useIntl();
    const errorId = useId();
    const workspace = useCurrentWorkspace();
    const candidates = useReviewerCandidates(scope, open);
    const request = useRequestReview(scope);
    const [picked, setPicked] = useState<string[]>([]);
    const [touched, setTouched] = useState(false);

    // Start from the people already asked, each time the dialog opens — not
    // from whatever was ticked before it was last cancelled.
    useEffect(() => {
        if (open) {
            setPicked([...currentReviewerIds]);
            setTouched(false);
        }
        // `currentReviewerIds` is a fresh array on every render of the rail;
        // the dialog re-seeds on opening, which is the moment that matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const nameOf = (userId: string, email: string) =>
        workspace?.members.find((member) => member.id === userId)?.name ??
        email;

    const toggle = (userId: string, checked: boolean) =>
        setPicked((current) =>
            checked
                ? current.includes(userId)
                    ? current
                    : [...current, userId]
                : current.filter((id) => id !== userId)
        );

    const showError = touched && picked.length === 0;

    const submit = () => {
        if (picked.length === 0) {
            setTouched(true);
            return;
        }
        request.mutate(
            {
                typeName: scope.typeName,
                entryId: scope.entryId,
                reviewerIds: picked
            },
            {
                onSuccess: () => {
                    toast.success(
                        intl.formatMessage(messages.done, {
                            count: picked.length
                        })
                    );
                    onOpenChange(false);
                },
                onError: () =>
                    toast.error(intl.formatMessage(messages.submitFailed))
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                {candidates.isPending ? (
                    <SkeletonRegion
                        label={intl.formatMessage(messages.loading)}
                    >
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="mt-2 h-5 w-40" />
                    </SkeletonRegion>
                ) : candidates.isError ? (
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-destructive">
                            {intl.formatMessage(messages.failed)}
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => candidates.refetch()}
                        >
                            {intl.formatMessage(messages.retry)}
                        </Button>
                    </div>
                ) : candidates.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.nobody)}
                    </p>
                ) : (
                    <fieldset
                        className="flex max-h-72 flex-col gap-3 overflow-y-auto"
                        aria-describedby={showError ? errorId : undefined}
                    >
                        <legend className="sr-only">
                            {intl.formatMessage(messages.legend)}
                        </legend>
                        {candidates.data.map((candidate) => (
                            <Label
                                key={candidate.userId}
                                className="flex items-center gap-3 text-sm font-normal"
                            >
                                <Checkbox
                                    checked={picked.includes(candidate.userId)}
                                    onCheckedChange={(next) =>
                                        toggle(candidate.userId, next === true)
                                    }
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate">
                                        {nameOf(
                                            candidate.userId,
                                            candidate.email
                                        )}
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {candidate.email}
                                    </span>
                                </span>
                            </Label>
                        ))}
                    </fieldset>
                )}

                {showError ? (
                    <FieldError id={errorId}>
                        {intl.formatMessage(messages.pickOne)}
                    </FieldError>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={request.isPending}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        type="button"
                        onClick={submit}
                        disabled={
                            request.isPending ||
                            !candidates.data ||
                            candidates.data.length === 0
                        }
                    >
                        {request.isPending ? <Spinner aria-hidden /> : null}
                        {intl.formatMessage(messages.submit)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
