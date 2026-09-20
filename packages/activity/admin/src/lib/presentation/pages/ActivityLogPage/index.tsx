import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Activity, ChevronDown, Filter } from 'lucide-react';
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
import {
    useActivityLog,
    DEFAULT_PAGE_SIZE
} from '../../../application/useActivityLog';
import { ActivityEmpty } from '../../components/ActivityEmpty';
import { ActivityLogTableSkeleton } from '../../components/ActivityLogSkeleton';
import { ActivityNoAccess } from '../../components/ActivityNoAccess';
import {
    ActivityPagination,
    PAGE_SIZE_OPTIONS
} from '../../components/ActivityPagination';
import { ActivityTable } from '../../components/ActivityTable';
import { ActivityToolbar } from '../../components/ActivityToolbar';
import { DeadLetterNotice } from '../../components/DeadLetterNotice';
import { ACTIVITY_FILTER_FIELDS } from '../../activityFilterFields';
import type { ActivityListParams } from '../../../infrastructure/activityKeys';

/** Intl descriptors for {@link ActivityLogPage}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'activity.page.title',
        defaultMessage: 'Activity'
    },
    subtitle: {
        id: 'activity.page.subtitle',
        // "this deployment", not "the workspace": `activity_events` has no
        // workspace column and this page sends no workspace context, so the
        // figure is deployment-wide by design. Saying "workspace" told an
        // admin of a multi-workspace deployment that the count was scoped when
        // it never was — on the page whose whole job is being the record of
        // record. See the plugin's AGENTS.md.
        defaultMessage:
            '{count, plural, one {# event} other {# events}} across this deployment.'
    },
    error: {
        id: 'activity.page.error',
        defaultMessage: 'Couldn’t load activity. Please try again.'
    },
    retry: {
        id: 'activity.page.retry',
        defaultMessage: 'Retry'
    },
    filters: {
        id: 'activity.page.filters',
        defaultMessage: 'Filters{count, plural, =0 {} other { (#)}}'
    },
    results: {
        id: 'activity.page.results',
        defaultMessage: '{count, plural, one {# event} other {# events}} found.'
    },
    resultsPaged: {
        id: 'activity.page.resultsPaged',
        defaultMessage:
            '{count, plural, one {# event} other {# events}} found. Showing {from}–{to}, page {page} of {pageCount}.'
    }
});

/**
 * The largest page size the server accepts (`MAX_PAGE_SIZE` on
 * `ListActivityQueryDto`). A hand-edited `?pageSize=` above it is a **400**, and
 * a 400 here is unrecoverable from the UI: the rows-per-page Select is the only
 * control that could fix it and it lives inside the data branch, which a failed
 * query never renders. So the URL value is clamped before it is ever sent —
 * Retry then has something that can succeed.
 */
const MAX_PAGE_SIZE = Math.max(...PAGE_SIZE_OPTIONS);

/**
 * The Activity Log page: a filterable, paginated, deep-linkable table of audit
 * events. The URL query string is the single source of truth for every filter
 * and page (via `useTableUrlState`), so a filtered view can be shared or
 * bookmarked. Rendered at `/activity` inside the authenticated shell.
 *
 * Gated on `activity:read` (admin-only): without it the page shows a no-access
 * state and fetches nothing (the server refuses the request anyway).
 */
export function ActivityLogPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    const canRead = useHasPermission('activity:read');

    const {
        searchParam: emailParam,
        filterParam,
        page,
        pageSize: rawPageSize,
        searchInput: emailInput,
        searchPending,
        setSearchInput: setEmailInput,
        updateParams
    } = useTableUrlState({
        searchKey: 'actorEmail',
        defaultPageSize: DEFAULT_PAGE_SIZE
    });

    // Rehydrate the applied filter tree from the URL for the drawer. Keyed on
    // the raw param so a deep-linked or hand-edited filter restores on load.
    const appliedFilter = useMemo(
        () => jsonFilterToTree(filterParam),
        [filterParam]
    );
    const ruleCount = countRules(appliedFilter);

    // `useTableUrlState` floors a nonsensical `?pageSize=` to the default but
    // has no ceiling, so an over-large one reaches the API and 400s.
    const pageSize = Math.min(rawPageSize, MAX_PAGE_SIZE);

    const params: ActivityListParams = {
        actorEmail: emailParam || undefined,
        filter: filterParam || undefined,
        page,
        pageSize
    };

    /** Commit (or clear) the query-builder filter to the URL. */
    // The inline filter panel: its own open state (the toolbar button toggles
    // it), with the ids wiring the button's `aria-controls` to the region.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const filtersPanelId = useId();
    const filtersToggleId = useId();
    const filtersToggleRef = useRef<HTMLButtonElement>(null);
    // Return focus to the toggle when the panel collapses (Apply / Esc), so the
    // now-`inert` panel doesn't strand focus on the body.
    const setFiltersPanelOpen = useCallback((open: boolean) => {
        setFiltersOpen(open);
        if (!open) filtersToggleRef.current?.focus();
    }, []);

    const applyFilter = useCallback(
        (next: FilterGroup | null) => {
            updateParams({ filter: treeToJsonFilter(next) ?? undefined });
        },
        [updateParams]
    );

    const { data, isPending, isFetching, isError, isPlaceholderData, refetch } =
        useActivityLog(params, canRead);

    const total = data?.total ?? 0;
    const effectivePageSize = data?.pageSize ?? pageSize;
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));

    // Pull `page` back when a filter change leaves fewer pages than the current
    // one, so we never strand the user on an empty page past the end. Guarded on
    // `data` so it runs only after a real response — before the first fetch lands
    // `total` is 0 and `pageCount` is 1, which would otherwise reset a deep-linked
    // `?page=N>1` back to page 1.
    useEffect(() => {
        if (data && page > pageCount) {
            updateParams(
                { page: pageCount > 1 ? String(pageCount) : undefined },
                false
            );
        }
    }, [data, page, pageCount, updateParams]);

    if (!canRead) {
        return (
            <>
                <PageTopBar
                    icon={Activity}
                    iconClassName="bg-info-soft text-info-soft-foreground"
                    crumbs={[
                        {
                            key: 'activity',
                            label: intl.formatMessage(messages.title)
                        }
                    ]}
                />
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(messages.title)}
                    />
                    <ActivityNoAccess />
                </Container>
            </>
        );
    }

    const events = data?.items ?? [];
    const hasFilters = Boolean(emailParam) || ruleCount > 0;

    // Clear the filters (actor-email + query builder) and reset to the first
    // page, preserving the chosen page size.
    //
    // Clearing makes the query return rows, so `ActivityEmpty` — and with it
    // the "Clear filters" button the user just pressed — unmounts. React does
    // not move focus when that happens, so it fell to `<body>` and the next Tab
    // restarted from the top of the document. Focus goes to the search box
    // instead, mirroring what `setFiltersPanelOpen` already does twelve lines
    // up (WCAG 2.4.3).
    const clearFilters = () => {
        setEmailInput('');
        updateParams({ actorEmail: undefined, filter: undefined });
        searchRef.current?.focus();
    };

    return (
        <>
            <PageTopBar
                icon={Activity}
                iconClassName="bg-info-soft text-info-soft-foreground"
                crumbs={[
                    {
                        key: 'activity',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle, {
                        count: total
                    })}
                />

                {/*
                  Above the toolbar, not below the table: the caveat is about
                  everything under it, and a reader who scrolls to the rows has
                  already started trusting them.
                */}
                <DeadLetterNotice />

                <ActivityToolbar
                    email={emailInput}
                    onEmailChange={setEmailInput}
                    searchRef={searchRef}
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
                    — the same accordion the records list uses, rather than a
                    drawer. It pushes the table down when open (no overlay);
                    collapsed with active filters, the applied conditions read
                    out as removable chips below. */}
                <QueryBuilderPanel
                    id={filtersPanelId}
                    labelledBy={filtersToggleId}
                    open={filtersOpen}
                    onOpenChange={setFiltersPanelOpen}
                    fields={ACTIVITY_FILTER_FIELDS}
                    value={appliedFilter}
                    onApply={applyFilter}
                />
                {!filtersOpen && appliedFilter && ruleCount > 0 ? (
                    <QueryBuilderSummary
                        className="mb-4"
                        tree={appliedFilter}
                        fields={ACTIVITY_FILTER_FIELDS}
                        onChange={applyFilter}
                    />
                ) : null}

                {/* Announce what changed to assistive tech after a filter or a
                    page change moves the table without a navigation (WCAG
                    4.1.3). The count alone is not enough: it is invariant
                    across pages, so pressing Next page replaced all 25 rows
                    and the region's text stayed identical — no announcement at
                    all, and "Page 2 of 3" is a plain <span> outside any live
                    region. Carrying the range and page here makes the text
                    change exactly when the table does. */}
                {!isPending && !isError && (
                    <p role="status" aria-live="polite" className="sr-only">
                        {events.length > 0
                            ? intl.formatMessage(messages.resultsPaged, {
                                  count: total,
                                  from: (page - 1) * effectivePageSize + 1,
                                  to: Math.min(page * effectivePageSize, total),
                                  page,
                                  pageCount
                              })
                            : intl.formatMessage(messages.results, {
                                  count: total
                              })}
                    </p>
                )}

                {isPending ? (
                    <ActivityLogTableSkeleton />
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
                ) : events.length === 0 ? (
                    <ActivityEmpty
                        filtered={hasFilters}
                        onClear={clearFilters}
                    />
                ) : (
                    <div aria-busy={isPlaceholderData}>
                        <ActivityTable events={events} />
                        <ActivityPagination
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
                    </div>
                )}
            </Container>
        </>
    );
}
