import { defineMessages, useIntl } from 'react-intl';
import { KeyRound } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import {
    Container,
    ContainerHeader,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';

/** Intl descriptors for the API-token skeletons, co-located here. */
const messages = defineMessages({
    title: { id: 'apiTokens.page.title', defaultMessage: 'API tokens' },
    subtitle: {
        id: 'apiTokens.page.subtitle',
        defaultMessage:
            'Bearer tokens for reading content through the external API.'
    },
    loading: {
        id: 'apiTokens.skeleton.loading',
        defaultMessage: 'Loading API tokens…'
    }
});

/**
 * The tokens-table placeholder shown while the first page loads. Built from the
 * real `Table` primitives inside the same card frame the loaded table uses, so
 * the columns and header line up exactly and nothing reflows on swap. Owns the
 * single `role="status"` announcement; the table itself is `aria-hidden`.
 */
export function ApiTokensSkeleton({ rows = 5 }: { rows?: number }) {
    const intl = useIntl();

    return (
        <div role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div
                aria-hidden
                className="mt-4 overflow-hidden rounded-xl border bg-card shadow-xs"
            >
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>
                                <Skeleton className="h-4 w-20" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-24" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-14" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-14" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead>
                                <Skeleton className="h-4 w-16" />
                            </TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: rows }).map((_, index) => (
                            <TableRow key={index}>
                                <TableCell>
                                    <Skeleton className="h-4 w-28" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-24" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-20" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-20" />
                                </TableCell>
                                <TableCell>
                                    <Skeleton className="h-4 w-20" />
                                </TableCell>
                                <TableCell>
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
 * Full-page placeholder for the lazy-route `Suspense` fallback. The chrome —
 * the {@link PageTopBar} and the container header — is **real**, not skeleton:
 * the bar is the page's identity (breadcrumb, icon, and the inline
 * sidebar-reveal trigger), so it must be there from the first paint rather than
 * popping in once the chunk resolves. Only the table body is a skeleton, which
 * is exactly what {@link ApiTokensPage} then swaps for its own `isPending`
 * state — so the chunk boundary is invisible and nothing shifts.
 */
export function ApiTokensPageSkeleton() {
    const intl = useIntl();

    return (
        <>
            <PageTopBar
                icon={KeyRound}
                crumbs={[
                    {
                        key: 'api-tokens',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                />
                <ApiTokensSkeleton />
            </Container>
        </>
    );
}
