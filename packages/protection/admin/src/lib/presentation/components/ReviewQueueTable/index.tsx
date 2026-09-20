import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import type { ReviewQueueItem } from '../../../domain/types';
import { ReviewerLabel } from '../ReviewerLabel';
import { RequestAge } from '../RequestAge';

const messages = defineMessages({
    entry: { id: 'protection.queue.col.entry', defaultMessage: 'Record' },
    type: { id: 'protection.queue.col.type', defaultMessage: 'Type' },
    requestedBy: {
        id: 'protection.queue.col.requestedBy',
        defaultMessage: 'Asked by'
    },
    reviewers: {
        id: 'protection.queue.col.reviewers',
        defaultMessage: 'Reviewers'
    },
    waiting: { id: 'protection.queue.col.waiting', defaultMessage: 'Waiting' },
    approvals: {
        id: 'protection.queue.col.approvals',
        defaultMessage: 'Approvals'
    },
    tally: {
        id: 'protection.queue.tally',
        defaultMessage: '{given} of {required} approvals'
    },
    open: { id: 'protection.queue.open', defaultMessage: 'Open {entry}' }
});

/**
 * One tab's worth of the reviewer queue.
 *
 * A real `<table>` with real `<th scope="col">` headers rather than a grid of
 * divs: the columns mean different things per row, and a screen reader
 * announcing "Articles, Anna Kovalyova, 2 days waiting" only makes sense when
 * each cell carries its header.
 *
 * **The tally is a sentence, not a fragment.** "1 of 2" read aloud out of a row
 * is a pair of numbers with no subject; the cell says "1 of 2 approvals" so it
 * is comprehensible wherever it is read from — which is the same reason the
 * entry editor's chip spells its own count out.
 */
export function ReviewQueueTable({
    items,
    currentUserId,
    overdueAfterDays
}: {
    /** The rows for this tab, already split by `splitQueue`. */
    items: readonly ReviewQueueItem[];
    /** The signed-in person, so their own name reads "You". */
    currentUserId?: string;
    /** The server's overdue cut, passed straight through to each age. */
    overdueAfterDays: number;
}) {
    const intl = useIntl();

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.entry)}
                    </TableHead>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.type)}
                    </TableHead>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.requestedBy)}
                    </TableHead>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.reviewers)}
                    </TableHead>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.waiting)}
                    </TableHead>
                    <TableHead scope="col">
                        {intl.formatMessage(messages.approvals)}
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((item) => (
                    <TableRow key={item.id}>
                        <TableCell>
                            {/* The queue carries ids, not titles — the entry
                                read that knows a record's title is per entry,
                                and a page of them would be the N+1 the batch
                                elsewhere exists to avoid. The link text names
                                the record it opens rather than saying "open",
                                so it still makes sense out of context. */}
                            <Link
                                to={`../content/${item.contentType}/${item.entryId}`}
                                className="font-medium underline-offset-4 hover:underline"
                            >
                                {intl.formatMessage(messages.open, {
                                    entry: item.entryId.slice(0, 8)
                                })}
                            </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                            {item.contentType}
                        </TableCell>
                        <TableCell>
                            <ReviewerLabel
                                userId={item.requestedBy}
                                currentUserId={currentUserId}
                            />
                        </TableCell>
                        <TableCell>
                            <ul className="flex flex-col gap-1">
                                {item.reviewerIds.map((userId) => (
                                    <li key={userId}>
                                        <ReviewerLabel
                                            userId={userId}
                                            currentUserId={currentUserId}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </TableCell>
                        <TableCell>
                            <RequestAge
                                createdAt={item.createdAt}
                                overdueAfterDays={overdueAfterDays}
                            />
                        </TableCell>
                        <TableCell>
                            {intl.formatMessage(messages.tally, {
                                given: item.given,
                                required: item.required
                            })}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
