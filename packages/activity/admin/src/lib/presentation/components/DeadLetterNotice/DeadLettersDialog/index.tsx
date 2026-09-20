import { type RefObject } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { RefreshCw } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@apograph/design-system';
import { activityDateTime } from '../../../activityDateTime';
import type { DeadLetter } from '../../../../types/deadLetter';

/** Intl descriptors for {@link DeadLettersDialog}, co-located with the component. */
const messages = defineMessages({
    dialogTitle: {
        id: 'activity.deadLetters.dialogTitle',
        defaultMessage: 'Events that were not recorded'
    },
    dialogDescription: {
        id: 'activity.deadLetters.dialogDescription',
        // "queued", never "recorded": the retry resets the attempt count, and
        // whether the event is finally delivered is the dispatcher's business
        // seconds later. Saying retrying is safe is a statement about
        // `activity:I-03` — the audit insert is `ON CONFLICT DO NOTHING`, so a
        // repeat is ignored — and it is why there is no confirmation step.
        defaultMessage:
            'Each of these gave up after repeated delivery failures, so what happened is missing from the log. Fix the cause, then queue one to be tried again. Retrying is safe: a delivery that did go through is ignored.'
    },
    tableCaption: {
        id: 'activity.deadLetters.tableCaption',
        defaultMessage: 'Events that could not be recorded'
    },
    columnEvent: {
        id: 'activity.deadLetters.columnEvent',
        defaultMessage: 'Event'
    },
    columnWhen: {
        id: 'activity.deadLetters.columnWhen',
        defaultMessage: 'When'
    },
    columnAttempts: {
        id: 'activity.deadLetters.columnAttempts',
        defaultMessage: 'Attempts'
    },
    columnError: {
        id: 'activity.deadLetters.columnError',
        defaultMessage: 'Last error'
    },
    columnActions: {
        id: 'activity.deadLetters.columnActions',
        defaultMessage: 'Actions'
    },
    retry: {
        id: 'activity.deadLetters.retry',
        defaultMessage: 'Retry'
    },
    retryLabel: {
        id: 'activity.deadLetters.retryLabel',
        defaultMessage: 'Retry {kind} from {when}'
    },
    retrying: {
        id: 'activity.deadLetters.retrying',
        defaultMessage: 'Queueing {kind}…'
    },
    noError: {
        id: 'activity.deadLetters.noError',
        defaultMessage: 'No message was recorded'
    },
    showingOf: {
        id: 'activity.deadLetters.showingOf',
        defaultMessage:
            'Showing {count, plural, one {# event} other {# events}} of {total}.'
    },
    loading: {
        id: 'activity.deadLetters.loading',
        defaultMessage: 'Loading the parked events…'
    },
    loadError: {
        id: 'activity.deadLetters.loadError',
        defaultMessage: 'Couldn’t load the parked events. Please try again.'
    },
    reload: {
        id: 'activity.deadLetters.reload',
        defaultMessage: 'Try again'
    },
    close: {
        id: 'activity.deadLetters.close',
        defaultMessage: 'Close'
    }
});

/**
 * The parked events in full, and the one operator action that clears them.
 *
 * This is where `lastError`, `occurredAt` and `attempts` are finally rendered:
 * they have been on the wire since the read route shipped and were shown
 * nowhere, and `lastError` is the single field that tells an operator whether
 * the cause is fixed. The banner deliberately stays a headline — it shows five
 * of an unbounded `total` and no ids, which is exactly why the retry lives
 * **per row in here** and there is no "Retry all" on the banner: a bulk action
 * would act on rows the operator has never seen.
 *
 * Unlike the banner, this surface renders its **error** state. The banner is
 * silent on error on purpose — a failed caveat must not be the reason the page
 * looks broken — but somebody who deliberately opened this dialog asked a
 * question, and answering an unanswered question with an empty table would say
 * "nothing is stuck", which is the opposite of what is known.
 *
 * `lastError` is arbitrary server text: it is rendered as a text node, never as
 * markup, and never hidden behind a `title=`.
 */
export function DeadLettersDialog({
    open,
    onOpenChange,
    triggerRef,
    items,
    total,
    isPending,
    isError,
    onReload,
    canRetry,
    retryingId,
    onRetry
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * The button that opened this, so focus can go back to it on close.
     *
     * Not optional and not decoration. A **modal** Radix dialog does not
     * restore focus to whatever had it before: `DialogContentModal` preventing
     * its own `onCloseAutoFocus` and focusing `context.triggerRef` instead — and
     * that ref is only set by a `DialogTrigger`. This dialog is opened by a
     * button in the banner's own layout rather than by a `DialogTrigger`, so
     * without this focus lands on `<body>` on Escape and the next Tab restarts
     * at the top of the document (WCAG 2.4.3).
     *
     * When the trigger is on its way out — the last parked event was just
     * retried — the node is detached and `focus()` is a no-op, which is exactly
     * right: the notice moves focus to `<main>` in that case instead.
     */
    triggerRef: RefObject<HTMLButtonElement | null>;
    /** The page the dialog fetched; empty while pending or on error. */
    items: DeadLetter[];
    /** The unbounded count, so the footer can say "N of M". */
    total: number;
    isPending: boolean;
    isError: boolean;
    /** Refetch, for the error branch's own retry. */
    onReload: () => void;
    /** Whether the reader holds `activity:manage`; hides the column if not. */
    canRetry: boolean;
    /** The row currently being queued, scoped from the mutation's variables. */
    retryingId: string | null;
    onRetry: (id: string) => void;
}) {
    const intl = useIntl();

    /** The row's date, formatted once for the cell and its button's name. */
    const whenOf = (item: DeadLetter) =>
        intl.formatDate(item.occurredAt, {
            dateStyle: 'medium',
            timeStyle: 'short'
        });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-lg sm:max-w-3xl"
                closeLabel={intl.formatMessage(messages.close)}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    triggerRef.current?.focus();
                }}
            >
                <DialogHeader>
                    {/* A real DialogTitle: Radix uses it as the dialog's
                        accessible name and warns when it is missing. */}
                    <DialogTitle>
                        {intl.formatMessage(messages.dialogTitle)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.dialogDescription)}
                    </DialogDescription>
                </DialogHeader>

                {isPending ? (
                    <div className="flex items-center justify-center py-10">
                        <Spinner aria-hidden="true" />
                        <span className="sr-only">
                            {intl.formatMessage(messages.loading)}
                        </span>
                    </div>
                ) : isError ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>
                                {intl.formatMessage(messages.loadError)}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                className="shadow-none"
                                onClick={onReload}
                            >
                                {intl.formatMessage(messages.reload)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : (
                    <div className="max-h-[60vh] overflow-auto rounded-xl border">
                        <Table>
                            <caption className="sr-only">
                                {intl.formatMessage(messages.tableCaption)}
                            </caption>
                            <TableHeader>
                                {/* No `aria-sort` anywhere: nothing here is
                                    sortable, and claiming otherwise is worse
                                    than saying nothing. */}
                                <TableRow>
                                    <TableHead scope="col">
                                        {intl.formatMessage(
                                            messages.columnEvent
                                        )}
                                    </TableHead>
                                    <TableHead scope="col">
                                        {intl.formatMessage(
                                            messages.columnWhen
                                        )}
                                    </TableHead>
                                    <TableHead scope="col">
                                        {intl.formatMessage(
                                            messages.columnAttempts
                                        )}
                                    </TableHead>
                                    <TableHead scope="col">
                                        {intl.formatMessage(
                                            messages.columnError
                                        )}
                                    </TableHead>
                                    {canRetry ? (
                                        <TableHead scope="col" className="w-28">
                                            {/* Redundant beside a column of
                                                buttons, but an empty header
                                                cell leaves the column unnamed
                                                to a screen reader (axe
                                                `empty-table-header`). */}
                                            <span className="sr-only">
                                                {intl.formatMessage(
                                                    messages.columnActions
                                                )}
                                            </span>
                                        </TableHead>
                                    ) : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => {
                                    const busy = retryingId === item.id;
                                    const when = whenOf(item);
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-mono text-xs">
                                                {item.kind}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                                {/* `activityDateTime` for the
                                                    machine-readable attribute
                                                    and `intl.formatDate` for
                                                    the visible text: both are
                                                    total, and `toISOString()`
                                                    on an unparseable wire
                                                    timestamp throws
                                                    (`activity:I-25`). */}
                                                <time
                                                    dateTime={activityDateTime(
                                                        item.occurredAt
                                                    )}
                                                >
                                                    {when}
                                                </time>
                                            </TableCell>
                                            <TableCell className="tabular-nums">
                                                {item.attempts}
                                            </TableCell>
                                            <TableCell>
                                                <span className="block max-w-sm break-words font-mono text-xs text-destructive">
                                                    {item.lastError ??
                                                        intl.formatMessage(
                                                            messages.noError
                                                        )}
                                                </span>
                                            </TableCell>
                                            {canRetry ? (
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="shadow-none"
                                                        // `aria-disabled`, not
                                                        // `disabled`: a
                                                        // disabled button
                                                        // leaves the tab order,
                                                        // so a keyboard user
                                                        // pressing Retry would
                                                        // lose their place the
                                                        // moment it went busy.
                                                        aria-disabled={busy}
                                                        aria-label={intl.formatMessage(
                                                            messages.retryLabel,
                                                            {
                                                                kind: item.kind,
                                                                when
                                                            }
                                                        )}
                                                        onClick={() => {
                                                            if (busy) return;
                                                            onRetry(item.id);
                                                        }}
                                                    >
                                                        {busy ? (
                                                            <>
                                                                <Spinner
                                                                    aria-hidden="true"
                                                                    className="size-4"
                                                                />
                                                                <span className="sr-only">
                                                                    {intl.formatMessage(
                                                                        messages.retrying,
                                                                        {
                                                                            kind: item.kind
                                                                        }
                                                                    )}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <RefreshCw
                                                                aria-hidden="true"
                                                                className="size-4"
                                                            />
                                                        )}
                                                        {intl.formatMessage(
                                                            messages.retry
                                                        )}
                                                    </Button>
                                                </TableCell>
                                            ) : null}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}

                <DialogFooter className="sm:items-center sm:justify-between">
                    {!isPending && !isError ? (
                        <span className="text-sm text-muted-foreground">
                            {intl.formatMessage(messages.showingOf, {
                                count: items.length,
                                total
                            })}
                        </span>
                    ) : (
                        <span />
                    )}
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {intl.formatMessage(messages.close)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
