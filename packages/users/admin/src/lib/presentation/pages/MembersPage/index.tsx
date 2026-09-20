import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronDown, Filter, UserPlus, Users } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import {
    QueryBuilderPanel,
    QueryBuilderSummary,
    countRules,
    jsonFilterToTree,
    treeToJsonFilter,
    type FilterGroup
} from '@orthacms/query-builder-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useTableUrlState, useDocumentTitle } from '@orthacms/utils-admin';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    cn
} from '@orthacms/design-system';
import { useMembers, DEFAULT_PAGE_SIZE } from '../../../application/useMembers';
import { MembersTableSkeleton } from '../../components/MembersSkeleton';
import { MembersEmpty } from '../../components/MembersEmpty';
import { MembersNoAccess } from '../../components/MembersNoAccess';
import { MembersPagination } from '../../components/MembersPagination';
import { MEMBERS_RESULTS_ANCHOR_ID } from '../../membersResultsAnchor';
import { MembersTable } from '../../components/MembersTable';
import { MembersToolbar } from '../../components/MembersToolbar';
import { MEMBERS_FILTER_FIELDS } from '../../membersFilterFields';
import type { MembersListParams } from '../../../infrastructure/membersKeys';

/** Intl descriptors for {@link MembersPage}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'users.page.title',
        defaultMessage: 'Members'
    },
    subtitle: {
        id: 'users.page.subtitle',
        defaultMessage:
            '{count, plural, one {# person} other {# people}} who can sign in to this workspace.'
    },
    invite: {
        id: 'users.page.invite',
        defaultMessage: 'Invite member'
    },
    error: {
        id: 'users.page.error',
        defaultMessage: 'Couldn’t load members. Please try again.'
    },
    retry: {
        id: 'users.page.retry',
        defaultMessage: 'Retry'
    },
    filters: {
        id: 'users.page.filters',
        defaultMessage: 'Filters{count, plural, =0 {} other { (#)}}'
    },
    results: {
        id: 'users.page.results',
        defaultMessage:
            '{count, plural, one {# member} other {# members}} found.'
    }
});

/**
 * The Members management page: a searchable, filterable, paginated, and
 * deep-linkable table of everyone who can sign in, with invite / edit / role /
 * status controls gated on the signed-in user's `users:*` permissions. The URL
 * query string is the single source of truth for search, the query-builder
 * filter, and the page (via `useTableUrlState`), so a filtered view can be
 * shared or bookmarked. Rendered at `/users` inside the authenticated shell.
 *
 * Gated on `users:read`: without it the page shows a no-access state and
 * fetches nothing (the server would refuse the request anyway).
 */
export function MembersPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    const navigate = useNavigate();
    const canRead = useHasPermission('users:read');
    const canInvite = useHasPermission('users:create');

    const {
        searchParam,
        filterParam,
        page,
        pageSize,
        searchInput,
        searchPending,
        setSearchInput,
        updateParams
    } = useTableUrlState({
        searchKey: 'search',
        defaultPageSize: DEFAULT_PAGE_SIZE
    });

    // Rehydrate the applied filter tree from the URL for the panel. Keyed on
    // the raw param so a deep-linked or hand-edited filter restores on load.
    const appliedFilter = useMemo(
        () => jsonFilterToTree(filterParam),
        [filterParam]
    );
    const ruleCount = countRules(appliedFilter);

    const params: MembersListParams = {
        search: searchParam || undefined,
        filter: filterParam || undefined,
        page,
        pageSize
    };

    const { data, isPending, isFetching, isError, refetch } = useMembers(
        params,
        canRead
    );

    const total = data?.total ?? 0;
    // The server echoes the effective page size; fall back to the requested one
    // until the first response lands.
    const effectivePageSize = data?.pageSize ?? pageSize;
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));

    // A mutation (revoke/disable) or a narrowing search/filter can leave fewer
    // pages than the current one; pull `page` back so we never strand the user
    // on an empty page past the end. Guarded on `data` so it runs only after a
    // real response — otherwise a deep-linked `?page=N>1` resets to 1 before the
    // first fetch lands (when `total` is 0 and `pageCount` is 1).
    useEffect(() => {
        if (data && page > pageCount) {
            updateParams(
                { page: pageCount > 1 ? String(pageCount) : undefined },
                false
            );
        }
    }, [data, page, pageCount, updateParams]);

    // The inline filter panel: its own open state (the toolbar button toggles
    // it), with the ids wiring the button's `aria-controls` to the region.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersPanelId = useId();
    const filtersToggleId = useId();
    const filtersToggleRef = useRef<HTMLButtonElement>(null);
    // Return focus to the toggle when the panel collapses (Esc, or a second
    // press), so the now-`inert` panel doesn't strand focus on the body.
    const setFiltersPanelOpen = useCallback((open: boolean) => {
        setFiltersOpen(open);
        if (!open) filtersToggleRef.current?.focus();
    }, []);

    /** Commit (or clear) the query-builder filter to the URL. */
    const applyFilter = useCallback(
        (next: FilterGroup | null) => {
            updateParams({ filter: treeToJsonFilter(next) ?? undefined });
        },
        [updateParams]
    );

    if (!canRead) {
        return (
            <>
                <PageTopBar
                    icon={Users}
                    iconClassName="bg-success-soft text-success-soft-foreground"
                    crumbs={[
                        {
                            key: 'members',
                            label: intl.formatMessage(messages.title)
                        }
                    ]}
                />
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(messages.title)}
                    />
                    <MembersNoAccess />
                </Container>
            </>
        );
    }

    const members = data?.items ?? [];
    const hasFilters = searchInput.trim().length > 0 || ruleCount > 0;

    /**
     * Clear the filters (search + query builder) and reset to the first page,
     * while preserving the user's page-size choice.
     */
    const clearFilters = () => {
        setSearchInput('');
        updateParams({ search: undefined, filter: undefined });
    };

    const openInvite = () => navigate('/users/invite');

    return (
        <>
            <PageTopBar
                icon={Users}
                iconClassName="bg-success-soft text-success-soft-foreground"
                crumbs={[
                    {
                        key: 'members',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    // No count until one is known: the read failed or hasn't
                    // landed, and "0 people" is a claim about the directory
                    // rather than a description of what happened.
                    subtitle={
                        isPending || isError
                            ? undefined
                            : intl.formatMessage(messages.subtitle, {
                                  count: total
                              })
                    }
                    actions={
                        canInvite ? (
                            <Button onClick={openInvite}>
                                <UserPlus />
                                {intl.formatMessage(messages.invite)}
                            </Button>
                        ) : undefined
                    }
                />

                <MembersToolbar
                    search={searchInput}
                    onSearchChange={setSearchInput}
                    busy={searchPending || isFetching}
                    filterControl={
                        <Button
                            ref={filtersToggleRef}
                            id={filtersToggleId}
                            variant="outline"
                            className="shadow-none"
                            aria-expanded={filtersOpen}
                            aria-controls={filtersPanelId}
                            onClick={() => setFiltersPanelOpen(!filtersOpen)}
                        >
                            <Filter aria-hidden className="size-4" />
                            {intl.formatMessage(messages.filters, {
                                count: ruleCount
                            })}
                            <ChevronDown
                                aria-hidden
                                className={cn(
                                    'size-4 transition-transform duration-150 motion-reduce:transition-none',
                                    filtersOpen && 'rotate-180'
                                )}
                            />
                        </Button>
                    }
                />

                {/* The filter builder, inline between the toolbar and the table
                    — the same accordion the activity log and the records list
                    use, rather than a drawer. It pushes the table down when
                    open (no overlay); collapsed with active filters, the
                    applied conditions read out as removable chips below. */}
                <QueryBuilderPanel
                    id={filtersPanelId}
                    labelledBy={filtersToggleId}
                    open={filtersOpen}
                    onOpenChange={setFiltersPanelOpen}
                    fields={MEMBERS_FILTER_FIELDS}
                    value={appliedFilter}
                    onApply={applyFilter}
                />
                {!filtersOpen && appliedFilter && ruleCount > 0 ? (
                    <QueryBuilderSummary
                        className="mb-4"
                        tree={appliedFilter}
                        fields={MEMBERS_FILTER_FIELDS}
                        onChange={applyFilter}
                    />
                ) : null}

                {/* Announce the result count to assistive tech after a search or
                filter changes the table without a navigation (WCAG 4.1.3). */}
                {!isPending && !isError && (
                    <p role="status" aria-live="polite" className="sr-only">
                        {intl.formatMessage(messages.results, { count: total })}
                    </p>
                )}

                {/* The focus anchor wraps every result state, not just the
                table: revoking the last row on screen swaps the table for the
                empty state, so an anchor on the table would unmount at exactly
                the moment focus needed somewhere to land. `tabIndex={-1}` keeps
                it focusable programmatically without adding a tab stop. */}
                <div
                    id={MEMBERS_RESULTS_ANCHOR_ID}
                    tabIndex={-1}
                    className="outline-none"
                >
                    {isPending ? (
                        <MembersTableSkeleton />
                    ) : isError ? (
                        <Alert
                            variant="destructive"
                            role="alert"
                            className="mt-4"
                        >
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                <span>
                                    {intl.formatMessage(messages.error)}
                                </span>
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
                    ) : members.length === 0 ? (
                        <MembersEmpty
                            filtered={hasFilters}
                            onClear={clearFilters}
                            onInvite={canInvite ? openInvite : undefined}
                        />
                    ) : (
                        <>
                            <MembersTable members={members} />
                            <MembersPagination
                                page={page}
                                pageCount={pageCount}
                                pageSize={effectivePageSize}
                                total={total}
                                onPageChange={(next) =>
                                    updateParams({ page: String(next) }, false)
                                }
                                onPageSizeChange={(next) =>
                                    updateParams({ pageSize: String(next) })
                                }
                            />
                        </>
                    )}
                </div>
            </Container>
        </>
    );
}
