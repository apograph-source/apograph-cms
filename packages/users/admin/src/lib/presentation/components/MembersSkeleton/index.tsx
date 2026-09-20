import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    WizardPageSkeleton
} from '@orthacms/design-system';

/** Intl descriptors for the members skeletons, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'users.skeleton.heading',
        defaultMessage: 'Loading members'
    },
    loading: {
        id: 'users.skeleton.loading',
        defaultMessage: 'Loading members…'
    },
    loadingForm: {
        id: 'users.skeleton.loadingForm',
        defaultMessage: 'Loading…'
    },
    loadingWorkspaces: {
        id: 'users.skeleton.loadingWorkspaces',
        defaultMessage: 'Loading workspaces…'
    }
});

/**
 * Section placeholder shown while {@link useWorkspaceOptions} resolves in the
 * invite wizard's "assign workspaces" step — two mode tiles over a short list of
 * option rows. Replaces the inline spinner so the step keeps its shape while the
 * list loads. Owns a single `role="status"`; the tiles are `aria-hidden`.
 */
export function WorkspaceOptionsSkeleton({ rows = 3 }: { rows?: number }) {
    const intl = useIntl();

    return (
        <div role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loadingWorkspaces)}
            </span>
            <div aria-hidden className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                </div>
                {Array.from({ length: rows }).map((_, index) => (
                    <div
                        key={index}
                        className="flex items-center gap-3 rounded-xl border p-3"
                    >
                        <Skeleton className="size-8 shrink-0 rounded-xl" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="ml-auto size-5 rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * The members-table placeholder shown while {@link useMembers} resolves. Built
 * from the real `Table` primitives so column widths and the header match the
 * loaded table exactly (no reflow on swap). Drops into the page body in place
 * of the table (header + toolbar stay live), so it owns the single
 * `role="status"` announcement; the table itself is `aria-hidden`.
 */
export function MembersTableSkeleton({ rows = 5 }: { rows?: number }) {
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
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-10" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-12" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-20" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-12" />
                            </TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: rows }).map((_, index) => (
                            <TableRow key={index}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="size-9 shrink-0 rounded-xl" />
                                        <div className="flex flex-col gap-1.5">
                                            <Skeleton className="h-3.5 w-28" />
                                            <Skeleton className="h-3 w-36" />
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </TableCell>
                                <TableCell>
                                    <div className="flex -space-x-2">
                                        <Skeleton className="size-6 rounded-xl" />
                                        <Skeleton className="size-6 rounded-xl" />
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-20" />
                                </TableCell>
                                <TableCell className="text-right">
                                    <Skeleton className="ml-auto size-8 rounded-md" />
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
 * {@link MembersPage} mounts there is no header or toolbar yet, so this sketches
 * the whole page (header, search toolbar, table) to hold the layout steady
 * while the chunk loads. Reuses {@link MembersTableSkeleton} for the body.
 */
export function MembersPageSkeleton() {
    const intl = useIntl();

    return (
        // `aria-busy` marks this as a loading placeholder so the host's route
        // announcer waits past the sr-only "Loading members" heading below and
        // reads the settled page name instead (see `RouteAnnouncer`).
        <Container aria-busy="true">
            {/* The page's `<h1>`, visually hidden. A lazy route's `Suspense`
                fallback is a whole page with no heading at all until the real
                one mounts — and it is the state a slow connection sits in
                longest, so it is the one most likely to be navigated by heading
                (`ORT-167`).

                It names the **state**, not the page, and deliberately: an `<h1>`
                repeating the loaded page's would put two identically-named
                level-one headings on screen across the swap, which is ambiguous
                to a reader and to anything locating by heading. "Loading X" is
                also the more useful thing to hear here. */}
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <Skeleton className="h-9 w-36 shrink-0" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-full sm:max-w-[360px]" />
            </div>

            <MembersTableSkeleton />
        </Container>
    );
}

/**
 * Lazy-route `Suspense` fallback for {@link InviteMemberPage}. Wraps the shared
 * {@link WizardPageSkeleton} so the `sr-only` status stays localized.
 */
export function InviteMemberPageSkeleton() {
    const intl = useIntl();

    return (
        <WizardPageSkeleton label={intl.formatMessage(messages.loadingForm)} />
    );
}
