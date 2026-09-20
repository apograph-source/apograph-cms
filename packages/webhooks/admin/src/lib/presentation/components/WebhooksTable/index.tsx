import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import type { WebhookEndpoint } from '../../../domain/types/webhook';
import { DeliveryStatusBadge } from '../DeliveryStatusBadge';

const messages = defineMessages({
    caption: {
        id: 'webhooks.table.caption',
        defaultMessage: 'Configured webhook endpoints'
    },
    name: { id: 'webhooks.table.name', defaultMessage: 'Name' },
    url: { id: 'webhooks.table.url', defaultMessage: 'URL' },
    events: { id: 'webhooks.table.events', defaultMessage: 'Sends' },
    state: { id: 'webhooks.table.state', defaultMessage: 'State' },
    lastDelivery: {
        id: 'webhooks.table.lastDelivery',
        defaultMessage: 'Last delivery'
    },
    active: { id: 'webhooks.table.active', defaultMessage: 'Active' },
    paused: { id: 'webhooks.table.paused', defaultMessage: 'Paused' },
    autoDisabled: {
        id: 'webhooks.table.autoDisabled',
        defaultMessage: 'Stopped after failures'
    },
    allEvents: { id: 'webhooks.table.allEvents', defaultMessage: 'All events' },
    someEvents: {
        id: 'webhooks.table.someEvents',
        defaultMessage: '{count, plural, one {# event} other {# events}}'
    },
    allWorkspaces: {
        id: 'webhooks.table.allWorkspaces',
        defaultMessage: 'All workspaces'
    },
    someWorkspaces: {
        id: 'webhooks.table.someWorkspaces',
        defaultMessage:
            '{count, plural, one {# workspace} other {# workspaces}}'
    },
    someTypes: {
        id: 'webhooks.table.someTypes',
        defaultMessage: '{count, plural, one {# type} other {# types}}'
    },
    never: { id: 'webhooks.table.never', defaultMessage: 'Nothing sent yet' }
});

/**
 * The endpoint list.
 *
 * The filter columns read as chips rather than as lists, because the question
 * from the list is "roughly what does this one take?" — the exact set belongs on
 * the detail page, where it can be edited.
 */
export function WebhooksTable({ endpoints }: { endpoints: WebhookEndpoint[] }) {
    const intl = useIntl();

    return (
        <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
                <caption className="sr-only">
                    {intl.formatMessage(messages.caption)}
                </caption>
                <TableHeader>
                    <TableRow>
                        <TableHead>
                            {intl.formatMessage(messages.name)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.url)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.events)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.state)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.lastDelivery)}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {endpoints.map((endpoint) => (
                        <TableRow key={endpoint.id}>
                            <TableCell className="font-medium">
                                <Link
                                    to={`/webhooks/${endpoint.id}`}
                                    className="underline-offset-4 hover:underline focus-visible:underline"
                                >
                                    {endpoint.name}
                                </Link>
                            </TableCell>
                            <TableCell className="max-w-[24rem] truncate font-mono text-xs text-muted-foreground">
                                {endpoint.url}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    <Badge variant="outline">
                                        {endpoint.eventKinds.length === 0
                                            ? intl.formatMessage(
                                                  messages.allEvents
                                              )
                                            : intl.formatMessage(
                                                  messages.someEvents,
                                                  {
                                                      count: endpoint.eventKinds
                                                          .length
                                                  }
                                              )}
                                    </Badge>
                                    <Badge variant="outline">
                                        {endpoint.allWorkspaces
                                            ? intl.formatMessage(
                                                  messages.allWorkspaces
                                              )
                                            : intl.formatMessage(
                                                  messages.someWorkspaces,
                                                  {
                                                      count: endpoint
                                                          .workspaceIds.length
                                                  }
                                              )}
                                    </Badge>
                                    {endpoint.contentTypes.length > 0 ? (
                                        <Badge variant="outline">
                                            {intl.formatMessage(
                                                messages.someTypes,
                                                {
                                                    count: endpoint.contentTypes
                                                        .length
                                                }
                                            )}
                                        </Badge>
                                    ) : null}
                                </div>
                            </TableCell>
                            <TableCell>
                                {endpoint.enabled ? (
                                    <Badge variant="secondary">
                                        {intl.formatMessage(messages.active)}
                                    </Badge>
                                ) : (
                                    // An endpoint the server switched off is a
                                    // different situation from one someone
                                    // paused, and the operator has to be able
                                    // to tell them apart at a glance.
                                    <Badge
                                        variant={
                                            endpoint.disabledReason
                                                ? 'destructive'
                                                : 'outline'
                                        }
                                    >
                                        {intl.formatMessage(
                                            endpoint.disabledReason
                                                ? messages.autoDisabled
                                                : messages.paused
                                        )}
                                    </Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                                {endpoint.lastDelivery ? (
                                    <span className="flex items-center gap-2">
                                        <DeliveryStatusBadge
                                            status={
                                                endpoint.lastDelivery.status
                                            }
                                        />
                                        <span>
                                            {intl.formatDate(
                                                endpoint.lastDelivery.createdAt,
                                                {
                                                    dateStyle: 'medium',
                                                    timeStyle: 'short'
                                                }
                                            )}
                                        </span>
                                    </span>
                                ) : (
                                    intl.formatMessage(messages.never)
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
