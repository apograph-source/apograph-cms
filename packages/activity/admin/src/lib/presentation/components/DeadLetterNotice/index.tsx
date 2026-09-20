import { useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { AlertTriangle } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    toast
} from '@ortha/design-system';
import { useHasPermission } from '@ortha/identity-admin';
import { ApiError, HTTP_STATUS } from '@ortha/utils-admin';
import {
    useDeadLetters,
    DIALOG_DEAD_LETTER_LIMIT,
    NOTICE_DEAD_LETTER_LIMIT
} from '../../../application/useDeadLetters';
import { useRetryDeadLetter } from '../../../application/useRetryDeadLetter';
import { useRefreshDeadLetters } from '../../../application/useRefreshDeadLetters';
import { DeadLettersDialog } from './DeadLettersDialog';

/** Intl descriptors for {@link DeadLetterNotice}, co-located here. */
const messages = defineMessages({
    title: {
        id: 'activity.deadLetters.title',
        defaultMessage:
            '{count, plural, one {# action was not recorded} other {# actions were not recorded}}'
    },
    body: {
        id: 'activity.deadLetters.body',
        defaultMessage:
            'The log below is incomplete. These events were retried and gave up, so what happened is not in it. Most recent: {kinds}.'
    },
    review: {
        id: 'activity.deadLetters.review',
        defaultMessage: 'Review and retry'
    },
    retried: {
        id: 'activity.deadLetters.retried',
        // "Queued", never "recorded": the retry resets the attempt count and
        // the dispatcher decides seconds later whether it finally lands.
        defaultMessage: 'Queued to be tried again.'
    },
    allClear: {
        id: 'activity.deadLetters.allClear',
        defaultMessage: 'Queued the last one — nothing is parked now.'
    },
    retryGone: {
        id: 'activity.deadLetters.retryGone',
        defaultMessage: 'That event is no longer parked.'
    },
    retryFailed: {
        id: 'activity.deadLetters.retryFailed',
        defaultMessage: 'Couldn’t queue that event. Please try again.'
    }
});

/** The shell's `<main>`, already `tabIndex={-1}` for the skip link. */
const MAIN_CONTENT_ID = 'main-content';

/**
 * Says, on the page whose whole job is being the record of record, that the
 * record has holes in it — and, for an operator who may act, opens the dialog
 * that closes them.
 *
 * An event that exhausted its delivery attempts is very often an audit row that
 * was never written. The dispatcher logs the moment one parks, but a log line is
 * loud only to somebody tailing logs right then — afterwards the question "is
 * anything missing from this log" had no answer short of a `psql` session, and
 * a gap only visible to a person who thinks to go looking is barely a gap that
 * has been noticed. This is that answer, in front of the reader who cares.
 *
 * **Renders nothing when there is nothing to say**, which is the normal case:
 * no placeholder, no "0 problems" row, no reserved space. It also renders
 * nothing while loading or on error — a caveat about a list must never be the
 * reason the page looks broken, and a failed *warning* is not itself news. The
 * dialog is the deliberate opposite: see {@link DeadLettersDialog}.
 *
 * The banner itself renders for anyone with `activity:read`; the trigger is
 * **hidden**, not disabled, without `activity:manage`. A permission an account
 * will never hold has no path through, so a permanently inert button explaining
 * itself is noise — while the information "three actions are missing" is true
 * for a reader either way.
 */
export function DeadLetterNotice() {
    const intl = useIntl();
    // `activity:I-28`: the enablement *is* the permission, stated here rather
    // than inherited from `ActivityLogPage`'s early return — this component is
    // mounted by the page but nothing stops a second surface mounting it.
    const canRead = useHasPermission('activity:read');
    const canManage = useHasPermission('activity:manage');

    const [open, setOpen] = useState(false);
    // Handed to the dialog so it can put focus back where it came from; a
    // modal Radix dialog only does that through a `DialogTrigger`, and this
    // trigger lives in the banner's own layout. See `DeadLettersDialog`.
    const triggerRef = useRef<HTMLButtonElement>(null);
    // `dataUpdatedAt`/`errorUpdatedAt` are read for the focus effect below, not
    // for rendering: they are the only values that change on *every* answer
    // this list gives, including one that repeats the count it gave before.
    const { data, dataUpdatedAt, errorUpdatedAt } = useDeadLetters(
        NOTICE_DEAD_LETTER_LIMIT,
        canRead
    );
    // The dialog's larger page is a separate cache entry (the limit is part of
    // the key), and it is not fetched until the dialog is first opened.
    const dialog = useDeadLetters(
        DIALOG_DEAD_LETTER_LIMIT,
        canRead && canManage && open
    );
    const retry = useRetryDeadLetter();
    const refreshDeadLetters = useRefreshDeadLetters();

    const total = data?.total ?? 0;

    // Armed by this reader's own retry, and **spent by the very next answer the
    // list gives**, whatever that answer says.
    //
    // It is deliberately not a latch. A flag that survived until some later
    // fetch happened to reach zero would move focus for things this reader did
    // not do — the retention sweep clearing the last row, another operator
    // retrying it, a poll landing on a tab regaining focus — which is the exact
    // theft the flag exists to prevent. It says "the refresh I am waiting for
    // has not arrived yet", not "I retried something at some point".
    const awaitingRetryRefresh = useRef(false);
    const previousTotal = useRef(total);

    // When the last dead letter goes, the notice returns `null` and takes the
    // dialog's trigger with it. Radix then restores focus to a node that no
    // longer exists, focus lands on `<body>`, and the next Tab restarts from the
    // top of the document (WCAG 2.4.3). `ActivityLogPage`'s `clearFilters` was
    // bitten by exactly this and answers it the same way.
    //
    // So: move focus when the answer to *this reader's* retry is that nothing
    // is parked any more, and at no other time. The `*UpdatedAt` dependencies
    // are what make "the next answer" mean the next answer rather than the next
    // *different* count — the flag has to be spent even when the refetch comes
    // back with the same total (the sweep parked another row in the meantime),
    // and even when it comes back a failure and says nothing at all.
    useEffect(() => {
        const previous = previousTotal.current;
        const answersOurRetry = awaitingRetryRefresh.current;
        previousTotal.current = total;
        awaitingRetryRefresh.current = false;
        if (answersOurRetry && total === 0 && previous > 0) {
            document.getElementById(MAIN_CONTENT_ID)?.focus();
        }
    }, [total, dataUpdatedAt, errorUpdatedAt]);

    if (!data || total === 0) {
        return null;
    }

    // The distinct kinds, so the notice says *what* is missing rather than only
    // how much — "3 actions were not recorded" is an alarm, "…: entry.updated,
    // media.asset.uploaded" is a lead.
    const kinds = [...new Set(data.items.map((item) => item.kind))].join(', ');

    /**
     * Queue one parked event, and say what happened.
     *
     * No confirmation step: `activity:I-03` makes the audit insert
     * `ON CONFLICT DO NOTHING`, so pressing this twice is pressing it once.
     * The toast is the announcement — sonner's live region is mounted once in
     * `createAdmin`, and the banner is already a `role="alert"`, so a
     * hand-rolled second live region here would be two.
     */
    const onRetry = (id: string) => {
        // Chosen at click time from the count the reader is looking at: this
        // is the only moment both facts — "it worked" and "that was the last
        // one" — are known in the same tick. A stale `total` costs a slightly
        // less specific toast and nothing else.
        const wasLast = total === 1;
        retry.mutate(
            { id },
            {
                onSuccess: () => {
                    // Armed here and read once, by the effect above, when the
                    // refresh this retry triggers lands.
                    awaitingRetryRefresh.current = true;
                    // Close before the refetch lands: on the way to zero the
                    // trigger is about to unmount, and Radix cannot restore
                    // focus to a button that no longer exists.
                    setOpen(false);
                    toast.success(
                        intl.formatMessage(
                            wasLast ? messages.allClear : messages.retried
                        )
                    );
                },
                onError: (error) => {
                    const status =
                        error instanceof ApiError ? error.status : null;
                    // 404 (unknown, or already delivered) and 409 (exists but
                    // has not given up yet) are one message: both mean the row
                    // the reader clicked is no longer parked, and the
                    // difference between them is not theirs to act on. This is
                    // a live race — the retention sweep and the dispatcher both
                    // move rows between the fetch and the click — so the list
                    // is refreshed rather than left saying something untrue.
                    const gone =
                        status === HTTP_STATUS.NOT_FOUND ||
                        status === HTTP_STATUS.CONFLICT;
                    toast.error(
                        intl.formatMessage(
                            gone ? messages.retryGone : messages.retryFailed
                        )
                    );
                    if (gone) {
                        // **Both** pages, not just the one the reader is
                        // looking at. Refetching the dialog alone left the
                        // banner counting — and naming the kinds of — a row
                        // the client had just been told is not parked any more.
                        refreshDeadLetters();
                    }
                    // A 401 needs nothing: the global interceptor signs the
                    // user out. A 403 — the permission lost mid-session — and
                    // a 5xx both land on the generic message above.
                }
            }
        );
    };

    return (
        <>
            <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" className="size-4" />
                <AlertTitle>
                    {intl.formatMessage(messages.title, { count: total })}
                </AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{intl.formatMessage(messages.body, { kinds })}</span>
                    {canManage ? (
                        <Button
                            ref={triggerRef}
                            size="sm"
                            variant="outline"
                            className="shadow-none"
                            onClick={() => setOpen(true)}
                        >
                            {intl.formatMessage(messages.review)}
                        </Button>
                    ) : null}
                </AlertDescription>
            </Alert>

            {/* Outside the banner, not inside it: the `Alert` is a
                `role="alert"` live region, and a dialog's worth of table
                mounting inside one would be announced wholesale. */}
            {canManage ? (
                <DeadLettersDialog
                    open={open}
                    onOpenChange={setOpen}
                    triggerRef={triggerRef}
                    items={dialog.data?.items ?? []}
                    total={dialog.data?.total ?? total}
                    isPending={dialog.isPending}
                    isError={dialog.isError}
                    // The same refresh as every other path here, for the same
                    // reason: "Try again" is asking the list again, and there
                    // is one list behind the two cache entries. Reloading only
                    // the dialog's page would let it recover into a count the
                    // banner above it still contradicts.
                    onReload={refreshDeadLetters}
                    canRetry={canManage}
                    // Scoped to the pressed row through the mutation's own
                    // variables rather than a panel-wide boolean, so one row's
                    // spinner does not freeze the other four.
                    retryingId={
                        retry.isPending ? (retry.variables?.id ?? null) : null
                    }
                    onRetry={onRetry}
                />
            ) : null}
        </>
    );
}
