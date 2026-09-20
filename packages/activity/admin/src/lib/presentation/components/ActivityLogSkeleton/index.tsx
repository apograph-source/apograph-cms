import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';

/** Intl descriptors for the activity skeletons, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'activity.skeleton.heading',
        defaultMessage: 'Loading activity'
    },
    loading: {
        id: 'activity.skeleton.loading',
        defaultMessage: 'Loading activity…'
    }
});

/**
 * The audit-log table placeholder shown while {@link useActivityLog} resolves.
 * Built from the real `Table` primitives so the columns (the leading expand
 * toggle + When · Actor · Action · Subject) match the loaded table exactly — no
 * reflow on swap. Drops into the page body in place of the table (header +
 * toolbar stay live), so it owns the single `role="status"` announcement; the
 * table itself is `aria-hidden`.
 */
export function ActivityLogTableSkeleton({ rows = 8 }: { rows?: number }) {
    const intl = useIntl();

    return (
        <div role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div aria-hidden className="rounded-xl border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>
                                <Skeleton className="h-4 w-24" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: rows }).map((_, index) => (
                            <TableRow key={index}>
                                <TableCell>
                                    <Skeleton className="size-5 rounded" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-28" />
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="size-8 shrink-0 rounded-xl" />
                                        <Skeleton className="h-4 w-32" />
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-5 w-24 rounded-full" />
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-16" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

/**
 * Full-page placeholder for the lazy-route `Suspense` fallback — before
 * {@link ActivityLogPage} mounts there is no header or toolbar yet, so this
 * sketches the whole page (header, toolbar, table) to hold the layout steady
 * while the chunk loads. Reuses {@link ActivityLogTableSkeleton} for the body.
 */
export function ActivityLogPageSkeleton() {
    const intl = useIntl();

    return (
        // `aria-busy` marks this as a loading placeholder so the host's route
        // announcer waits past the sr-only heading below and reads the settled
        // page name instead (see `RouteAnnouncer`).
        <Container aria-busy="true">
            {/* The page's `<h1>`, visually hidden. A lazy route's `Suspense`
                fallback is a whole page with no heading until the real one
                mounts, so it fails the `page-has-heading-one` axe rule and is
                unnavigable by heading (`ORT-167`). It names the state, not the
                page, matching the Members and Content library skeletons. */}
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <div className="mb-6 flex flex-col gap-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-64 max-w-full" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-full sm:max-w-[220px]" />
                <Skeleton className="h-9 w-full sm:max-w-[280px]" />
            </div>

            <ActivityLogTableSkeleton />
        </Container>
    );
}
