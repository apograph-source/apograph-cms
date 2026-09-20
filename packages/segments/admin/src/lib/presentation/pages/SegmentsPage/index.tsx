import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import {
    Globe,
    MoreHorizontal,
    Pencil,
    Plus,
    Search,
    ShieldCheck,
    Trash2
} from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useDebouncedValue, useDocumentTitle } from '@orthacms/utils-admin';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    ConfirmDialog,
    Container,
    ContainerHeader,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Input,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    toast
} from '@orthacms/design-system';
import type { Segment } from '../../../domain/types';
import {
    SEGMENTS_MANAGE,
    SEGMENTS_READ,
    useDeleteSegment,
    useSegments
} from '../../../application/hooks';
import { SegmentsPagination } from '../../components/SegmentsPagination';
import { SegmentsListSkeleton } from '../../components/SegmentsListSkeleton';

const messages = defineMessages({
    title: { id: 'segments.page.title', defaultMessage: 'Segments' },
    subtitle: {
        id: 'segments.page.subtitle',
        defaultMessage:
            'The audiences your readers are divided into. An entry then says which of them may read it.'
    },
    create: { id: 'segments.page.create', defaultMessage: 'New audience' },
    search: { id: 'segments.page.search', defaultMessage: 'Search audiences' },
    colName: { id: 'segments.page.colName', defaultMessage: 'Audience' },
    colTags: { id: 'segments.page.colTags', defaultMessage: 'Reader tags' },
    colWorkspaces: {
        id: 'segments.page.colWorkspaces',
        defaultMessage: 'Offered in'
    },
    colUsage: { id: 'segments.page.colUsage', defaultMessage: 'Used by' },
    colActions: { id: 'segments.page.colActions', defaultMessage: 'Actions' },
    everywhere: {
        id: 'segments.page.everywhere',
        defaultMessage: 'Every workspace'
    },
    workspaceCount: {
        id: 'segments.page.workspaceCount',
        defaultMessage:
            '{count, plural, one {# workspace} other {# workspaces}}'
    },
    usage: {
        id: 'segments.page.usage',
        defaultMessage: '{count, plural, one {# entry} other {# entries}}'
    },
    unused: { id: 'segments.page.unused', defaultMessage: 'Not used yet' },
    menu: { id: 'segments.page.menu', defaultMessage: 'Actions for {name}' },
    edit: { id: 'segments.page.edit', defaultMessage: 'Edit' },
    remove: { id: 'segments.page.remove', defaultMessage: 'Delete' },
    confirmTitle: {
        id: 'segments.page.confirmTitle',
        defaultMessage: 'Delete “{name}”?'
    },
    confirmBody: {
        id: 'segments.page.confirmBody',
        defaultMessage:
            'It is removed from every entry that names it. An entry that only refused this audience becomes readable by everyone; an entry that only allowed it stops being readable by anyone but the other audiences it names.'
    },
    confirmUnused: {
        id: 'segments.page.confirmUnused',
        defaultMessage:
            'No entry names it, so nothing any reader sees will change.'
    },
    confirm: { id: 'segments.page.confirmCta', defaultMessage: 'Delete' },
    cancel: { id: 'segments.page.cancel', defaultMessage: 'Cancel' },
    retry: { id: 'segments.page.retry', defaultMessage: 'Try again' },
    emptyTitle: {
        id: 'segments.page.emptyTitle',
        defaultMessage: 'No audiences yet'
    },
    emptyBody: {
        id: 'segments.page.emptyBody',
        defaultMessage:
            'Until one exists every published entry is readable by everyone, and nothing about your content API changes. Create one to start deciding who sees what.'
    },
    noMatches: {
        id: 'segments.page.noMatches',
        defaultMessage: 'No audience matches “{query}”.'
    },
    error: {
        id: 'segments.page.error',
        defaultMessage: 'Couldn’t load the audiences.'
    },
    writeError: {
        id: 'segments.page.writeError',
        defaultMessage: 'Couldn’t save that. Please try again.'
    },
    noAccessTitle: {
        id: 'segments.page.noAccessTitle',
        defaultMessage: 'You don’t have access to segments'
    },
    noAccessBody: {
        id: 'segments.page.noAccessBody',
        defaultMessage:
            'Ask an administrator for the “segments:read” permission to see which readers content is restricted to.'
    },
    results: {
        id: 'segments.page.results',
        defaultMessage: '{count, plural, one {# audience} other {# audiences}}'
    }
});

/** Rows per page before anyone changes it. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * The audience directory at `/segments`.
 *
 * One list, four actions. Everything about *what an audience may read* happens
 * on the entry, which is why this page has no notion of rules, targets or
 * levels — it manages the vocabulary, and the entry editor uses it.
 *
 * Creating and editing are **pages** (`/segments/new`, `/segments/:id`), not a
 * dialog: an audience now also decides which workspaces may use it, and a modal
 * that scrolls is a modal that has outgrown being one.
 *
 * Gated on `segments:read`; the write controls additionally on
 * `segments:manage`. The split is the point of two permissions: an editor needs
 * to *see* that an entry is restricted — one who cannot will publish something
 * believing it is public — while renaming an audience's tags changes who every
 * entry naming it is visible to.
 */
export function SegmentsPage() {
    const intl = useIntl();
    useDocumentTitle(intl.formatMessage(messages.title));
    const canRead = useHasPermission(SEGMENTS_READ);
    const canManage = useHasPermission(SEGMENTS_MANAGE);

    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, 250);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

    // A narrowed search almost always has fewer pages than the one before it,
    // so staying on page four is how a reader lands on "no matches" for a term
    // that matches plenty.
    useEffect(() => setPage(1), [debounced, pageSize]);

    const { data, isPending, isError, refetch } = useSegments({
        query: debounced || undefined,
        page,
        pageSize
    });

    const [pending, setPending] = useState<Segment | null>(null);
    const remove = useDeleteSegment();

    const bar = (
        <PageTopBar
            icon={ShieldCheck}
            crumbs={[
                { key: 'segments', label: intl.formatMessage(messages.title) }
            ]}
        />
    );

    if (!canRead) {
        return (
            <>
                {bar}
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(messages.title)}
                    />
                    <div className="mt-8 flex flex-col items-center gap-3 text-center">
                        <ShieldCheck
                            className="size-10 text-muted-foreground"
                            aria-hidden
                        />
                        <h2 className="text-lg font-medium">
                            {intl.formatMessage(messages.noAccessTitle)}
                        </h2>
                        <p className="max-w-md text-sm text-muted-foreground">
                            {intl.formatMessage(messages.noAccessBody)}
                        </p>
                    </div>
                </Container>
            </>
        );
    }

    const failed = () => toast.error(intl.formatMessage(messages.writeError));
    const segments = data?.items ?? [];
    const total = data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return (
        <>
            {bar}
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                    actions={
                        canManage && (total > 0 || Boolean(debounced)) ? (
                            <Button asChild>
                                <Link to="/segments/new">
                                    <Plus aria-hidden />
                                    {intl.formatMessage(messages.create)}
                                </Link>
                            </Button>
                        ) : undefined
                    }
                />

                {/* Deleting changes the table without a navigation and without a
                    heading change, so announce the count. */}
                {!isPending && !isError ? (
                    <p role="status" aria-live="polite" className="sr-only">
                        {intl.formatMessage(messages.results, { count: total })}
                    </p>
                ) : null}

                {isPending ? (
                    // The same skeleton the route's own chunk fallback draws,
                    // so loading the page and loading its rows are one shape
                    // rather than two.
                    <SegmentsListSkeleton />
                ) : isError ? (
                    <Alert variant="destructive" role="alert" className="mt-4">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>{intl.formatMessage(messages.error)}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="shadow-none"
                                onClick={() => refetch()}
                            >
                                {intl.formatMessage(messages.retry)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : total === 0 && !debounced ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ShieldCheck aria-hidden />
                            </EmptyMedia>
                            <EmptyTitle>
                                {intl.formatMessage(messages.emptyTitle)}
                            </EmptyTitle>
                            <EmptyDescription>
                                {intl.formatMessage(messages.emptyBody)}
                            </EmptyDescription>
                        </EmptyHeader>
                        {canManage ? (
                            <EmptyContent>
                                <Button asChild>
                                    <Link to="/segments/new">
                                        <Plus aria-hidden />
                                        {intl.formatMessage(messages.create)}
                                    </Link>
                                </Button>
                            </EmptyContent>
                        ) : null}
                    </Empty>
                ) : (
                    <>
                        <div className="relative w-64">
                            <Search
                                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                                aria-hidden
                            />
                            <Input
                                className="pl-8"
                                type="search"
                                value={query}
                                aria-label={intl.formatMessage(messages.search)}
                                placeholder={intl.formatMessage(
                                    messages.search
                                )}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                            />
                        </div>

                        {total === 0 ? (
                            <p className="mt-4 text-sm text-muted-foreground">
                                {intl.formatMessage(messages.noMatches, {
                                    query: debounced
                                })}
                            </p>
                        ) : (
                            <>
                                <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-xs">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>
                                                    {intl.formatMessage(
                                                        messages.colName
                                                    )}
                                                </TableHead>
                                                <TableHead>
                                                    {intl.formatMessage(
                                                        messages.colTags
                                                    )}
                                                </TableHead>
                                                <TableHead>
                                                    {intl.formatMessage(
                                                        messages.colWorkspaces
                                                    )}
                                                </TableHead>
                                                <TableHead>
                                                    {intl.formatMessage(
                                                        messages.colUsage
                                                    )}
                                                </TableHead>
                                                {/* Named, not empty. A header
                                                    cell with no text is a
                                                    column a screen reader
                                                    announces as nothing at all
                                                    while reading every row's
                                                    menu under it. */}
                                                <TableHead className="w-12">
                                                    <span className="sr-only">
                                                        {intl.formatMessage(
                                                            messages.colActions
                                                        )}
                                                    </span>
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {segments.map((segment) => (
                                                <TableRow key={segment.id}>
                                                    <TableCell className="font-medium">
                                                        {canManage ? (
                                                            <Link
                                                                to={`/segments/${segment.id}`}
                                                                className="hover:underline"
                                                            >
                                                                {segment.label}
                                                            </Link>
                                                        ) : (
                                                            segment.label
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap gap-1">
                                                            {segment.tags.map(
                                                                (tag) => (
                                                                    <code
                                                                        key={
                                                                            tag
                                                                        }
                                                                        className="rounded bg-muted px-1.5 py-0.5 text-xs"
                                                                    >
                                                                        {tag}
                                                                    </code>
                                                                )
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {/* Empty means every
                                                            workspace, so it is
                                                            said rather than
                                                            left blank. */}
                                                        <Badge
                                                            variant={
                                                                segment
                                                                    .workspaceIds
                                                                    .length
                                                                    ? 'secondary'
                                                                    : 'outline'
                                                            }
                                                        >
                                                            {segment
                                                                .workspaceIds
                                                                .length ? null : (
                                                                <Globe
                                                                    className="size-3"
                                                                    aria-hidden
                                                                />
                                                            )}
                                                            {segment
                                                                .workspaceIds
                                                                .length
                                                                ? intl.formatMessage(
                                                                      messages.workspaceCount,
                                                                      {
                                                                          count: segment
                                                                              .workspaceIds
                                                                              .length
                                                                      }
                                                                  )
                                                                : intl.formatMessage(
                                                                      messages.everywhere
                                                                  )}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {segment.usageCount > 0
                                                            ? intl.formatMessage(
                                                                  messages.usage,
                                                                  {
                                                                      count: segment.usageCount
                                                                  }
                                                              )
                                                            : intl.formatMessage(
                                                                  messages.unused
                                                              )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {canManage ? (
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger
                                                                    asChild
                                                                >
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="ml-auto"
                                                                        aria-label={intl.formatMessage(
                                                                            messages.menu,
                                                                            {
                                                                                name: segment.label
                                                                            }
                                                                        )}
                                                                    >
                                                                        <MoreHorizontal
                                                                            aria-hidden
                                                                        />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuItem
                                                                        asChild
                                                                    >
                                                                        <Link
                                                                            to={`/segments/${segment.id}`}
                                                                        >
                                                                            <Pencil
                                                                                aria-hidden
                                                                            />
                                                                            {intl.formatMessage(
                                                                                messages.edit
                                                                            )}
                                                                        </Link>
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        className="text-destructive focus:text-destructive"
                                                                        onSelect={() =>
                                                                            setPending(
                                                                                segment
                                                                            )
                                                                        }
                                                                    >
                                                                        <Trash2
                                                                            aria-hidden
                                                                        />
                                                                        {intl.formatMessage(
                                                                            messages.remove
                                                                        )}
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        ) : null}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>

                                <SegmentsPagination
                                    page={page}
                                    pageCount={pageCount}
                                    pageSize={pageSize}
                                    total={total}
                                    onPageChange={setPage}
                                    onPageSizeChange={setPageSize}
                                />
                            </>
                        )}
                    </>
                )}
            </Container>

            <ConfirmDialog
                open={pending !== null}
                onOpenChange={(open) => {
                    if (!open) setPending(null);
                }}
                busy={remove.isPending}
                title={intl.formatMessage(messages.confirmTitle, {
                    name: pending?.label ?? ''
                })}
                // The consequence is spelled out per case rather than as "are
                // you sure": deleting an audience an entry *refused* opens that
                // entry, and deleting one an entry *allowed* closes it further.
                // Both are surprises worth naming before they happen.
                description={intl.formatMessage(
                    pending && pending.usageCount > 0
                        ? messages.confirmBody
                        : messages.confirmUnused
                )}
                confirmLabel={intl.formatMessage(messages.confirm)}
                cancelLabel={intl.formatMessage(messages.cancel)}
                confirmVariant="destructive"
                onConfirm={() => {
                    if (pending) {
                        remove.mutate(pending.id, {
                            onError: failed,
                            // Deleting the last row of the last page would
                            // otherwise strand the reader on a page that no
                            // longer exists, looking at an empty table.
                            onSuccess: () =>
                                setPage((current) =>
                                    segments.length === 1 && current > 1
                                        ? current - 1
                                        : current
                                )
                        });
                    }
                    setPending(null);
                }}
            />
        </>
    );
}
