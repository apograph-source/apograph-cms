import { defineMessages, useIntl } from 'react-intl';
import { RefreshCw } from 'lucide-react';
import {
    Button,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Spinner
} from '@orthacms/design-system';
import type { WebhookDeliveryDetail } from '../../../../domain/types/webhook';
import { DeliveryStatusBadge } from '../../DeliveryStatusBadge';

const messages = defineMessages({
    title: { id: 'webhooks.delivery.title', defaultMessage: 'Delivery' },
    description: {
        id: 'webhooks.delivery.description',
        defaultMessage: 'What was sent, and what came back.'
    },
    request: {
        id: 'webhooks.delivery.request',
        defaultMessage: 'Request body'
    },
    response: {
        id: 'webhooks.delivery.response',
        defaultMessage: 'Response'
    },
    noResponse: {
        id: 'webhooks.delivery.noResponse',
        defaultMessage: 'The receiver sent no body.'
    },
    error: { id: 'webhooks.delivery.error', defaultMessage: 'Error' },
    event: { id: 'webhooks.delivery.event', defaultMessage: 'Event' },
    attempts: { id: 'webhooks.delivery.attempts', defaultMessage: 'Attempts' },
    statusCode: {
        id: 'webhooks.delivery.statusCode',
        defaultMessage: 'HTTP status'
    },
    duration: { id: 'webhooks.delivery.duration', defaultMessage: 'Took' },
    durationValue: {
        id: 'webhooks.delivery.durationValue',
        defaultMessage: '{ms} ms'
    },
    nextAttempt: {
        id: 'webhooks.delivery.nextAttempt',
        defaultMessage: 'Next attempt'
    },
    eventId: {
        id: 'webhooks.delivery.eventId',
        defaultMessage: 'Event id (deduplicate on this)'
    },
    redeliver: {
        id: 'webhooks.delivery.redeliver',
        defaultMessage: 'Send again'
    },
    none: { id: 'webhooks.delivery.none', defaultMessage: '—' }
});

/** One labelled fact in the summary grid. */
function Fact({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{children}</dd>
        </div>
    );
}

/**
 * One delivery in full — the body that was posted, the response that came back,
 * and the button to send it again.
 *
 * The request body is shown verbatim rather than re-derived, because it is
 * stored verbatim: what is on screen is byte-for-byte what the receiver was
 * sent, which is the only version worth debugging against.
 */
export function DeliveryDetailSheet({
    delivery,
    open,
    onOpenChange,
    canRedeliver,
    redelivering,
    onRedeliver
}: {
    /** The delivery, or `undefined` while it loads. */
    delivery: WebhookDeliveryDetail | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    canRedeliver: boolean;
    redelivering: boolean;
    onRedeliver: (deliveryId: string) => void;
}) {
    const intl = useIntl();

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>
                        {intl.formatMessage(messages.title)}
                    </SheetTitle>
                    <SheetDescription>
                        {intl.formatMessage(messages.description)}
                    </SheetDescription>
                </SheetHeader>

                {!delivery ? (
                    <div className="flex justify-center py-8">
                        <Spinner />
                    </div>
                ) : (
                    <>
                        <dl className="grid grid-cols-2 gap-3 px-4">
                            <Fact label={intl.formatMessage(messages.event)}>
                                <span className="font-mono text-xs">
                                    {delivery.eventKind}
                                </span>
                            </Fact>
                            <Fact
                                label={intl.formatMessage(messages.statusCode)}
                            >
                                <span className="flex items-center gap-2">
                                    <DeliveryStatusBadge
                                        status={delivery.status}
                                    />
                                    {delivery.statusCode ??
                                        intl.formatMessage(messages.none)}
                                </span>
                            </Fact>
                            <Fact label={intl.formatMessage(messages.attempts)}>
                                {delivery.attempts}
                            </Fact>
                            <Fact label={intl.formatMessage(messages.duration)}>
                                {delivery.durationMs === null
                                    ? intl.formatMessage(messages.none)
                                    : intl.formatMessage(
                                          messages.durationValue,
                                          { ms: delivery.durationMs }
                                      )}
                            </Fact>
                            {delivery.nextAttemptAt ? (
                                <Fact
                                    label={intl.formatMessage(
                                        messages.nextAttempt
                                    )}
                                >
                                    {intl.formatDate(delivery.nextAttemptAt, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                    })}
                                </Fact>
                            ) : null}
                            <Fact label={intl.formatMessage(messages.eventId)}>
                                <span className="font-mono text-xs break-all">
                                    {delivery.eventId}
                                </span>
                            </Fact>
                        </dl>

                        {delivery.error ? (
                            <section className="px-4">
                                <h3 className="mb-1 text-xs text-muted-foreground">
                                    {intl.formatMessage(messages.error)}
                                </h3>
                                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {delivery.error}
                                </p>
                            </section>
                        ) : null}

                        <section className="px-4">
                            <h3 className="mb-1 text-xs text-muted-foreground">
                                {intl.formatMessage(messages.request)}
                            </h3>
                            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                                {JSON.stringify(delivery.payload, null, 2)}
                            </pre>
                        </section>

                        <section className="px-4">
                            <h3 className="mb-1 text-xs text-muted-foreground">
                                {intl.formatMessage(messages.response)}
                            </h3>
                            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                                {delivery.responseSnippet ??
                                    intl.formatMessage(messages.noResponse)}
                            </pre>
                        </section>

                        {canRedeliver ? (
                            <SheetFooter>
                                <Button
                                    variant="outline"
                                    disabled={redelivering}
                                    onClick={() => onRedeliver(delivery.id)}
                                >
                                    <RefreshCw aria-hidden />
                                    {intl.formatMessage(messages.redeliver)}
                                </Button>
                            </SheetFooter>
                        ) : null}
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
