import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    toast
} from '@orthacms/design-system';
import { DELIVERY_STATUSES } from '../../../domain/types/webhook';
import {
    DEFAULT_PAGE_SIZE,
    useWebhookDeliveries,
    useWebhookDelivery
} from '../../../application/useWebhookDeliveries';
import { useRedeliverWebhook } from '../../../application/useWebhookMutations';
import { DeliveryStatusBadge } from '../DeliveryStatusBadge';
import { DeliveryDetailSheet } from './DeliveryDetailSheet';

const messages = defineMessages({
    caption: {
        id: 'webhooks.deliveries.caption',
        defaultMessage: 'Delivery log'
    },
    event: { id: 'webhooks.deliveries.event', defaultMessage: 'Event' },
    status: { id: 'webhooks.deliveries.status', defaultMessage: 'Status' },
    code: { id: 'webhooks.deliveries.code', defaultMessage: 'Response' },
    attempts: {
        id: 'webhooks.deliveries.attempts',
        defaultMessage: 'Attempts'
    },
    when: { id: 'webhooks.deliveries.when', defaultMessage: 'Queued' },
    empty: {
        id: 'webhooks.deliveries.empty',
        defaultMessage:
            'Nothing has been sent yet. A delivery appears here the moment content this endpoint subscribes to changes.'
    },
    error: {
        id: 'webhooks.deliveries.error',
        defaultMessage: 'Couldn’t load the delivery log. Please try again.'
    },
    retry: { id: 'webhooks.deliveries.retry', defaultMessage: 'Retry' },
    filterAll: {
        id: 'webhooks.deliveries.filterAll',
        defaultMessage: 'All states'
    },
    filterLabel: {
        id: 'webhooks.deliveries.filterLabel',
        defaultMessage: 'Filter by state'
    },
    view: { id: 'webhooks.deliveries.view', defaultMessage: 'View' },
    actions: { id: 'webhooks.deliveries.actions', defaultMessage: 'Actions' },
    prev: { id: 'webhooks.deliveries.prev', defaultMessage: 'Previous' },
    next: { id: 'webhooks.deliveries.next', defaultMessage: 'Next' },
    pageOf: {
        id: 'webhooks.deliveries.pageOf',
        defaultMessage: 'Page {page} of {pageCount}'
    },
    redelivered: {
        id: 'webhooks.deliveries.redelivered',
        defaultMessage: 'Queued to send again'
    },
    redeliverFailed: {
        id: 'webhooks.deliveries.redeliverFailed',
        defaultMessage: 'Couldn’t queue it again. Please try again.'
    },
    statusPending: {
        id: 'webhooks.status.pending',
        defaultMessage: 'Queued'
    },
    statusDelivering: {
        id: 'webhooks.status.delivering',
        defaultMessage: 'Sending'
    },
    statusSucceeded: {
        id: 'webhooks.status.succeeded',
        defaultMessage: 'Delivered'
    },
    statusFailed: { id: 'webhooks.status.failed', defaultMessage: 'Retrying' },
    statusDead: { id: 'webhooks.status.dead', defaultMessage: 'Failed' }
});

/** The filter dropdown's label for each state — same wording as the chips. */
const STATUS_LABELS = {
    pending: messages.statusPending,
    delivering: messages.statusDelivering,
    succeeded: messages.statusSucceeded,
    failed: messages.statusFailed,
    dead: messages.statusDead
} as const;

/** Sentinel for "no state filter" — a `Select` cannot hold an empty value. */
const ALL = 'all';

/**
 * One endpoint's delivery log.
 *
 * The list polls itself while anything in it is still in flight (see
 * `useWebhookDeliveries`), so a queued delivery becomes a delivered one on
 * screen without anybody pressing refresh.
 */
export function WebhookDeliveriesPanel({
    endpointId,
    canRedeliver
}: {
    endpointId: string;
    canRedeliver: boolean;
}) {
    const intl = useIntl();
    const [status, setStatus] = useState<string>(ALL);
    const [page, setPage] = useState(1);
    const [openDeliveryId, setOpenDeliveryId] = useState<string | null>(null);

    const { data, isPending, isError, refetch } = useWebhookDeliveries(
        endpointId,
        {
            page,
            pageSize: DEFAULT_PAGE_SIZE,
            ...(status === ALL ? {} : { status })
        }
    );
    const { data: detail } = useWebhookDelivery(endpointId, openDeliveryId);
    const redeliver = useRedeliverWebhook();

    // The log shrinks under the reader — retention prunes it, a filter narrows
    // it — so a page number that was valid a moment ago can point past the end.
    // Following the server's clamp keeps the pager and the rows in agreement
    // instead of showing an empty page with no way back.
    useEffect(() => {
        if (data && page > data.pageCount) {
            setPage(data.pageCount);
        }
    }, [data, page]);

    if (isError) {
        return (
            <Alert variant="destructive" role="alert" className="mt-4">
                <AlertDescription className="flex items-center justify-between gap-4">
                    {intl.formatMessage(messages.error)}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void refetch()}
                    >
                        {intl.formatMessage(messages.retry)}
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    const items = data?.items ?? [];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end">
                <Select
                    value={status}
                    onValueChange={(next) => {
                        setStatus(next);
                        setPage(1);
                    }}
                >
                    <SelectTrigger
                        className="w-48"
                        aria-label={intl.formatMessage(messages.filterLabel)}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>
                            {intl.formatMessage(messages.filterAll)}
                        </SelectItem>
                        {DELIVERY_STATUSES.map((value) => (
                            <SelectItem key={value} value={value}>
                                {intl.formatMessage(STATUS_LABELS[value])}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {!isPending && items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : (
                <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                    <Table>
                        <caption className="sr-only">
                            {intl.formatMessage(messages.caption)}
                        </caption>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    {intl.formatMessage(messages.event)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.status)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.code)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.attempts)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.when)}
                                </TableHead>
                                <TableHead className="w-20">
                                    {/* Visually redundant beside a row of
                                        buttons, but a header cell with no text
                                        leaves the column unnamed to a screen
                                        reader (axe `empty-table-header`). */}
                                    <span className="sr-only">
                                        {intl.formatMessage(messages.actions)}
                                    </span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((delivery) => (
                                <TableRow key={delivery.id}>
                                    <TableCell className="font-mono text-xs">
                                        {delivery.eventKind}
                                    </TableCell>
                                    <TableCell>
                                        <DeliveryStatusBadge
                                            status={delivery.status}
                                        />
                                    </TableCell>
                                    <TableCell className="tabular-nums">
                                        {delivery.statusCode ?? '—'}
                                    </TableCell>
                                    <TableCell className="tabular-nums">
                                        {delivery.attempts}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {intl.formatDate(delivery.createdAt, {
                                            dateStyle: 'medium',
                                            timeStyle: 'short'
                                        })}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() =>
                                                setOpenDeliveryId(delivery.id)
                                            }
                                        >
                                            {intl.formatMessage(messages.view)}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {data && data.pageCount > 1 ? (
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.pageOf, {
                            page: data.page,
                            pageCount: data.pageCount
                        })}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={data.page <= 1}
                            onClick={() => setPage((prev) => prev - 1)}
                        >
                            {intl.formatMessage(messages.prev)}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={data.page >= data.pageCount}
                            onClick={() => setPage((prev) => prev + 1)}
                        >
                            {intl.formatMessage(messages.next)}
                        </Button>
                    </div>
                </div>
            ) : null}

            <DeliveryDetailSheet
                delivery={detail}
                open={openDeliveryId !== null}
                onOpenChange={(next) => {
                    if (!next) setOpenDeliveryId(null);
                }}
                canRedeliver={canRedeliver}
                redelivering={redeliver.isPending}
                onRedeliver={(deliveryId) =>
                    redeliver.mutate(
                        { endpointId, deliveryId },
                        {
                            onSuccess: () => {
                                toast.success(
                                    intl.formatMessage(messages.redelivered)
                                );
                                setOpenDeliveryId(null);
                            },
                            onError: () =>
                                toast.error(
                                    intl.formatMessage(messages.redeliverFailed)
                                )
                        }
                    )
                }
            />
        </div>
    );
}
