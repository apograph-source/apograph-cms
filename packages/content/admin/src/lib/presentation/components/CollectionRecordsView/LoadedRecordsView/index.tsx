import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from 'react';
import {
    Link,
    NavigationType,
    useNavigate,
    useNavigationType,
    useSearchParams
} from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    ArrowLeft,
    ChevronDown,
    FileText,
    Filter,
    Plus,
    Table2,
    Trash2
} from 'lucide-react';
import {
    QueryBuilderPanel,
    QueryBuilderSummary,
    countRules,
    jsonFilterToTree,
    treeToJsonFilter,
    type FilterGroup
} from '@orthacms/query-builder-admin';
import { useTableUrlState } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    SearchToolbar,
    cn,
    toast
} from '@orthacms/design-system';
import type {
    ContentType,
    ContentTypeDetail
} from '../../../../domain/types/contentType';
import {
    COLUMN_KIND,
    CONTENT_CREATE,
    CONTENT_DELETE,
    CONTENT_FIELD_TYPE,
    CONTENT_SEGMENT,
    CONTENT_TYPE_KIND,
    DEFAULT_PAGE_SIZE,
    NEW_SEGMENT,
    SEARCH_PARAM,
    SORT_PARAM,
    TRASH_SEGMENT,
    VIEW_PARAM,
    VIEWS_SHARE
} from '../../../../domain/constants';
import {
    captureViewPayload,
    droppedColumnCount,
    isViewDirty,
    reconcileColumns,
    viewPayloadToParams
} from '../../../../domain/viewPayload';
import {
    VIEW_VISIBILITY,
    type SavedView
} from '../../../../domain/types/savedView';
import {
    contentScope,
    useSavedViews
} from '../../../../application/useSavedViews';
import { useSaveView } from '../../../../application/useSaveView';
import { useUpdateView } from '../../../../application/useUpdateView';
import { useDeleteView } from '../../../../application/useDeleteView';
import { useSetDefaultView } from '../../../../application/useSetDefaultView';
import { ViewSwitcher } from '../../ViewSwitcher';
import { SaveViewDialog } from '../../ViewSwitcher/SaveViewDialog';
import { useContentEntries } from '../../../../application/useContentEntries';
import { useEntryColumns } from '../../../hooks/useEntryColumns';
import { useColumnLabel } from '../../../hooks/useColumnLabel';
import { useSlotListParams } from '../../../hooks/useSlotListParams';
import { entryColumns } from '../../../../domain/entryColumns';
import { listParamsQuery } from '../../../../domain/listParamsQuery';
import { useFilterFields } from '../../../../application/useFilterFields';
import { RelationValuePicker } from '../../RelationValuePicker';
import {
    RECORDS_COLUMN_SLOT,
    RECORDS_FILTER_FIELDS_SLOT,
    RECORDS_TOOLBAR_SLOT
} from '../../../slots/contentSlots';
import { CollectionRecordsTable } from '../CollectionRecordsTable';
import { CollectionRecordsColumnPicker } from '../CollectionRecordsColumnPicker';
import {
    CollectionRecordsPagination,
    PAGE_SIZE_OPTIONS
} from '../CollectionRecordsPagination';
import { CollectionRecordsEmpty } from '../CollectionRecordsEmpty';
import { CollectionRecordsSkeleton } from '../CollectionRecordsSkeleton';
import { CollectionRecordsSelectionBar } from '../CollectionRecordsSelectionBar';
import { CollectionRecordsBulkActions } from '../CollectionRecordsBulkActions';
import { CollectionRecordsMenu } from '../CollectionRecordsMenu';

/** Intl descriptors for {@link LoadedRecordsView}, co-located. */
const messages = defineMessages({
    subtitle: {
        id: 'content.records.subtitle',
        defaultMessage:
            '{count, plural, one {# record} other {# records}} in this collection.'
    },
    add: { id: 'content.records.add', defaultMessage: 'Add record' },
    trashTitle: {
        id: 'content.records.trashTitle',
        defaultMessage: '{label} · Trash'
    },
    trashSubtitle: {
        id: 'content.records.trashSubtitle',
        defaultMessage:
            '{count, plural, one {# deleted record} other {# deleted records}}.'
    },
    backToRecords: {
        id: 'content.records.backToRecords',
        defaultMessage: 'Back to records'
    },
    searchLabel: {
        id: 'content.records.searchLabel',
        defaultMessage: 'Search records'
    },
    searchPlaceholder: {
        id: 'content.records.searchPlaceholder',
        defaultMessage: 'Search records'
    },
    filters: {
        id: 'content.records.filters',
        defaultMessage: 'Filters{count, plural, =0 {} other { · #}}'
    },
    loading: {
        id: 'content.records.loading',
        defaultMessage: 'Loading records…'
    },
    results: {
        id: 'content.records.results',
        defaultMessage:
            '{count, plural, one {# record} other {# records}} found.'
    },
    error: {
        id: 'content.records.error',
        defaultMessage: 'Couldn’t load this collection. Please try again.'
    },
    retry: { id: 'content.records.retry', defaultMessage: 'Retry' },
    selectionStatus: {
        id: 'content.records.selection.status',
        defaultMessage:
            '{count, plural, =0 {No rows selected.} one {# row selected.} other {# rows selected.}}'
    },
    viewStatus: {
        id: 'content.records.viewStatus',
        defaultMessage:
            'Showing {from}–{to} of {total}, page {page} of {pageCount}.'
    },
    sortStatus: {
        id: 'content.records.sortStatus',
        defaultMessage:
            'Sorted by {column}, {direction, select, desc {descending} other {ascending}}.'
    },
    sortNone: {
        id: 'content.records.sortNone',
        defaultMessage: 'Not sorted.'
    },
    viewSaved: {
        id: 'content.records.viewSaved',
        defaultMessage: 'View updated.'
    },
    viewSaveFailed: {
        id: 'content.records.viewSaveFailed',
        defaultMessage: 'Couldn’t update this view. Please try again.'
    },
    viewDeleted: {
        id: 'content.records.viewDeleted',
        defaultMessage: 'View deleted.'
    },
    viewDeleteFailed: {
        id: 'content.records.viewDeleteFailed',
        defaultMessage: 'Couldn’t delete this view. Please try again.'
    },
    viewCreated: {
        id: 'content.records.viewCreated',
        defaultMessage: '“{name}” saved.'
    },
    viewCreatedDefault: {
        id: 'content.records.viewCreatedDefault',
        defaultMessage: '“{name}” saved and set as your default view.'
    },
    viewDefaultSet: {
        id: 'content.records.viewDefaultSet',
        defaultMessage: '“{name}” is now your default view for this collection.'
    },
    viewDefaultCleared: {
        id: 'content.records.viewDefaultCleared',
        defaultMessage:
            'Cleared your default view — this collection opens on All records.'
    },
    viewDefaultFailed: {
        id: 'content.records.viewDefaultFailed',
        defaultMessage: 'Couldn’t change your default view. Please try again.'
    },
    viewsError: {
        id: 'content.records.viewsError',
        defaultMessage: 'Saved views are unavailable right now.'
    },
    // Keeps the switcher's original message id: the copy didn't change, only
    // where it is drawn, and re-keying it would throw away its translations.
    viewDroppedColumns: {
        id: 'content.views.switcher.droppedColumns',
        defaultMessage:
            '{count, plural, one {# column in this view no longer exists and was skipped.} other {# columns in this view no longer exist and were skipped.}}'
    }
});

/**
 * The records table once the schema is loaded — split out so every
 * schema-dependent hook (columns, entries) runs with a defined schema from its
 * first render. Mirrors `MembersPage`: URL-as-source-of-truth for search/filter/
 * page (via `useTableUrlState`), a page-clamp after a narrowing change, and the
 * query-builder glue.
 */
export function LoadedRecordsView({
    type,
    schema,
    trashed = false
}: {
    type: ContentType;
    schema: ContentTypeDetail;
    /** Render the trash view (soft-deleted rows, restore/purge actions). */
    trashed?: boolean;
}) {
    const intl = useIntl();
    const navigate = useNavigate();
    const workspace = useCurrentWorkspace();
    const typePath = `/workspaces/${workspace.id}/${CONTENT_SEGMENT}/${type.name}`;
    const canCreate = useHasPermission(CONTENT_CREATE);
    const canDelete = useHasPermission(CONTENT_DELETE);
    const paranoid = schema.paranoid ?? false;
    const publishable = schema.publishable ?? false;

    const {
        searchParam,
        filterParam,
        page,
        pageSize: pageSizeParam,
        searchInput,
        searchPending,
        setSearchInput,
        updateParams
    } = useTableUrlState({
        searchKey: SEARCH_PARAM,
        defaultPageSize: DEFAULT_PAGE_SIZE
    });

    // `pageSize` comes from the URL, so it can be anything — and the server
    // rejects anything over its own cap with a **400**, not a clamp. Left
    // unchecked, `?pageSize=999` rendered the collection's error card with no
    // way back: Retry re-sends the same parameter, and the rows-per-page select
    // only exists inside a footer that needs rows to render. Narrow it to the
    // sizes this table actually offers, so a hand-edited or stale link
    // degrades to the default instead of stranding the reader.
    const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam)
        ? pageSizeParam
        : DEFAULT_PAGE_SIZE;

    // Sort lives in the URL too (`?sort=<columnId>` asc, `?sort=-<columnId>`
    // desc), beside the table state above. Clicking a header cycles
    // asc → desc → off (cleared).
    const [searchParams] = useSearchParams();
    const sortParam = searchParams.get(SORT_PARAM) ?? '';
    const sort = useMemo(() => {
        if (!sortParam) return null;
        const desc = sortParam.startsWith('-');
        const key = desc ? sortParam.slice(1) : sortParam;
        return key
            ? { key, dir: desc ? ('desc' as const) : ('asc' as const) }
            : null;
    }, [sortParam]);
    const handleSort = useCallback(
        (columnId: string) => {
            const next =
                !sort || sort.key !== columnId
                    ? columnId
                    : sort.dir === 'asc'
                      ? `-${columnId}`
                      : undefined;
            updateParams({ [SORT_PARAM]: next });
        },
        [sort, updateParams]
    );

    // Slot-contributed toolbar items and their URL-owned list params (e.g. the
    // i18n plugin's `?locale=`). The values are forwarded to the list request
    // verbatim and ride the query key. Slot items are boot-frozen, so reading
    // them during render is stable.
    const toolbarItems = RECORDS_TOOLBAR_SLOT.getItems();
    const slotParamKeys = useMemo(
        () => toolbarItems.flatMap((item) => item.listParamKeys ?? []),
        [toolbarItems]
    );
    const slotParams = useSlotListParams(slotParamKeys);

    const extensionColumnItems = RECORDS_COLUMN_SLOT.getItems();
    const { columns, defaults } = useMemo(
        () => entryColumns(schema, extensionColumnItems),
        [schema, extensionColumnItems]
    );
    const availableIds = useMemo(
        () => columns.map((column) => column.id),
        [columns]
    );
    const { isVisible, toggle, visible, reorder, replace } = useEntryColumns(
        type.name,
        availableIds,
        defaults
    );

    // ---- Saved views -------------------------------------------------------
    // The switcher's whole state lives here, beside the URL params it replays,
    // because a view *is* those params plus the column selection above.
    const scope = contentScope(type.name);
    const canShareViews = useHasPermission(VIEWS_SHARE);
    const viewParam = searchParams.get(VIEW_PARAM);
    // Trash is a route segment, not a param, and its rows are a different set —
    // saving a view over it would produce a slice that only makes sense on one
    // of the two pages. Left out deliberately until it earns its own model.
    const viewsEnabled = !trashed;
    const {
        data: savedViews,
        isPending: viewsPending,
        isError: viewsError
    } = useSavedViews(scope, viewsEnabled);
    const views = useMemo(() => savedViews ?? [], [savedViews]);
    const activeView = useMemo(
        () => views.find((view) => view.id === viewParam) ?? null,
        [views, viewParam]
    );

    const saveView = useSaveView(scope);
    const updateView = useUpdateView(scope);
    const deleteView = useDeleteView(scope);
    const setDefaultView = useSetDefaultView(scope);
    // Render columns in the persisted visible order (reconcile() guarantees the
    // ids are available, so the lookup never misses).
    const columnById = useMemo(
        () => new Map(columns.map((column) => [column.id, column])),
        [columns]
    );
    const visibleColumns = useMemo(
        () =>
            visible
                .map((id) => columnById.get(id))
                .filter((column) => column !== undefined),
        [visible, columnById]
    );

    // Row selection — by id, persisting across paging; cleared via the bar.
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const toggleRow = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const setPageSelection = useCallback((ids: string[], select: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of ids) {
                if (select) next.add(id);
                else next.delete(id);
            }
            return next;
        });
    }, []);
    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
    // A single-row delete/purge/restore takes the row out of this view, but the
    // selection is keyed by id and spans pages, so nothing was dropping it: the
    // bar kept counting a record that no longer exists, and a later bulk action
    // still submitted its id (the server's dry run answered "No longer
    // available" beside a raw uuid). Drop it at the source instead.
    const forgetRow = useCallback((id: string) => {
        setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    // Server-derived filter surface (scalar fields + recursive relation paths),
    // replacing the old client-side `filterFieldsFromSchema` mirror. Its load
    // state is threaded into the panel: with no field definitions every rule
    // fails the Apply gate, so an empty picker would read as a dead button.
    const {
        fields: schemaFilterFields,
        isPending: filterFieldsPending,
        isError: filterFieldsError,
        refetch: refetchFilterFields
    } = useFilterFields(schema.name);
    // Slot-contributed filter fields (e.g. locale aggregates), appended after
    // the schema-derived set. Hook-in-a-loop is rules-of-hooks-safe here:
    // slot items are registered once at boot and never change, so the call
    // order is stable across renders (see the slot module's JSDoc).
    const slotFilterFields = RECORDS_FILTER_FIELDS_SLOT.getItems().flatMap(
        (item) => item.useFields(schema)
    );
    const filterFields = [...schemaFilterFields, ...slotFilterFields];
    const appliedFilter = useMemo(
        () => jsonFilterToTree(filterParam),
        [filterParam]
    );
    const ruleCount = countRules(appliedFilter);

    // Ask the server to expand only the relation columns actually on screen, so
    // hiding one stops it being resolved. Empty when no relation column is
    // visible — the list then carries no relation cost at all.
    const relationFields = useMemo(
        () =>
            visibleColumns
                .filter(
                    (column) =>
                        column.kind === COLUMN_KIND.Field &&
                        column.field.type === CONTENT_FIELD_TYPE.Relation
                )
                .map((column) => column.id)
                // Sorted so a pure reorder doesn't mint a new query key: the
                // server resolves a *set* of fields, and display order is not
                // part of that request. Unsorted, dragging one relation column
                // past another would refetch the whole page for a visual change.
                .sort()
                .join(','),
        [visibleColumns]
    );

    // `keepPreviousData` means a narrowing change leaves the *old* rows on
    // screen while the new request is in flight — correct for typing (no
    // flicker per keystroke), but with no cue at all for the deliberate
    // actions. So Apply and a page change each raise a flag that swaps the
    // table for its skeleton until the request settles.
    const [applying, setApplying] = useState(false);
    const [paging, setPaging] = useState(false);
    const { data, isPending, isFetching, isError, isPlaceholderData, refetch } =
        useContentEntries(schema, {
            search: searchParam || undefined,
            filter: filterParam || undefined,
            sort: sortParam || undefined,
            page,
            pageSize,
            deleted: trashed ? 'only' : undefined,
            ...(relationFields
                ? { relations: 'preview' as const, relationFields }
                : {}),
            ...(slotParamKeys.length ? { extra: slotParams } : {})
        });

    // Clear either skeleton once its request has settled.
    useEffect(() => {
        if (isFetching) return;
        if (applying) setApplying(false);
        if (paging) setPaging(false);
    }, [applying, paging, isFetching]);

    const total = data?.total ?? 0;
    const effectivePageSize = data?.pageSize ?? pageSize;
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));

    // Sorting and paging used to change the table in total silence: the live
    // region's only content was the **total**, which is exactly what neither
    // action changes (WCAG 4.1.3). Restate the view instead — which slice is on
    // screen, and what it is ordered by — so a header click or a Next press is
    // distinguishable from a click that did nothing.
    const viewStatus = intl.formatMessage(messages.viewStatus, {
        from: total === 0 ? 0 : (page - 1) * effectivePageSize + 1,
        to: Math.min(page * effectivePageSize, total),
        total,
        page,
        pageCount
    });
    const columnLabel = useColumnLabel();
    const sortedColumn = sort
        ? visibleColumns.find((column) => column.id === sort.key)
        : undefined;
    const sortStatus = sortedColumn
        ? intl.formatMessage(messages.sortStatus, {
              column: columnLabel(sortedColumn),
              direction: sort?.dir ?? 'asc'
          })
        : intl.formatMessage(messages.sortNone);

    // A narrowing search/filter can leave fewer pages than the current one; pull
    // `page` back so we never strand the user past the end (copied from
    // MembersPage). Guarded on `data` so a deep-linked `?page=N` survives the
    // first fetch, and on `!isPlaceholderData` so the clamp reads the freshly
    // fetched `total` — not the previous page's count that `keepPreviousData`
    // holds in `data` while the narrowed request is still in flight.
    useEffect(() => {
        if (data && !isPlaceholderData && page > pageCount) {
            updateParams(
                { page: pageCount > 1 ? String(pageCount) : undefined },
                false
            );
        }
    }, [data, isPlaceholderData, page, pageCount, updateParams]);

    const applyFilter = useCallback(
        (next: FilterGroup | null) => {
            updateParams({ filter: treeToJsonFilter(next) ?? undefined });
        },
        [updateParams]
    );

    // The live slice, in the same shape a stored payload has — one object both
    // the dirty check and "Save" read, so what the badge compares can never
    // drift from what the button writes.
    const listState = useMemo(
        () => ({
            filter: filterParam,
            sort: sortParam,
            pageSize,
            columns: visible,
            extra: slotParams
        }),
        [filterParam, sortParam, pageSize, visible, slotParams]
    );
    const viewIsDirty = activeView
        ? isViewDirty(activeView.payload, listState, availableIds)
        : false;
    const droppedColumns = activeView
        ? droppedColumnCount(activeView.payload, availableIds)
        : 0;

    // Seed the columns an applied view pins. In an effect keyed on the view's
    // id — not during render — so it lands *after* `useEntryColumns` has done
    // its own per-type re-seed on the one commit where both change (a deep link
    // into another collection's view).
    //
    // A view going *away* is handled by `applyView`, not here: this effect only
    // ever seeds, so arriving at a URL with no `?view=` (Back out of one, say)
    // leaves whatever the reader had on screen rather than yanking the columns.
    const availableKey = availableIds.join(',');
    useEffect(() => {
        if (!activeView) return;
        replace(reconcileColumns(activeView.payload, availableIds));
        // `availableIds` is rebuilt per render; its serialized form is the real
        // dependency, and `replace` is stable across renders that changed nothing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView?.id, availableKey, replace]);

    /** Replays a view's payload into the URL, or clears back to the plain list. */
    const applyView = useCallback(
        (view: SavedView | null) => {
            setApplying(true);
            if (!view) {
                updateParams({
                    [VIEW_PARAM]: undefined,
                    filter: undefined,
                    [SORT_PARAM]: undefined,
                    page: undefined
                });
                replace(null);
                return;
            }
            updateParams({
                ...viewPayloadToParams(view.payload, slotParamKeys),
                [SORT_PARAM]: view.payload.sort || undefined,
                [VIEW_PARAM]: view.id
            });
            replace(reconcileColumns(view.payload, availableIds));
        },
        [updateParams, replace, slotParamKeys, availableIds]
    );

    const [saveViewOpen, setSaveViewOpen] = useState(false);
    const [saveViewError, setSaveViewError] = useState<number | null>(null);

    const handleSaveNew = useCallback(
        (input: {
            name: string;
            visibility: (typeof VIEW_VISIBILITY)[keyof typeof VIEW_VISIBILITY];
            makeDefault: boolean;
        }) => {
            setSaveViewError(null);
            saveView.mutate(
                {
                    scope,
                    name: input.name,
                    visibility: input.visibility,
                    payload: captureViewPayload(listState),
                    makeDefault: input.makeDefault
                },
                {
                    onSuccess: (created) => {
                        setSaveViewOpen(false);
                        // Point the URL at the new view so the trigger names it
                        // immediately; the slice is already on screen, so this
                        // is the only param that changes.
                        updateParams({ [VIEW_PARAM]: created.id }, false);
                        // Which is also why the save needs saying out loud: the
                        // table doesn't move, so the only evidence of a
                        // successful save is the dialog going away. The
                        // default variant reports the checkbox the dialog
                        // offered, which changes nothing visible at all.
                        toast.success(
                            intl.formatMessage(
                                input.makeDefault
                                    ? messages.viewCreatedDefault
                                    : messages.viewCreated,
                                { name: created.name }
                            )
                        );
                    },
                    // The name collision is the one failure worth its own copy —
                    // it names something the user can fix in the field they are
                    // already looking at.
                    onError: (error) => setSaveViewError(readStatus(error) ?? 0)
                }
            );
        },
        [saveView, scope, listState, updateParams, intl]
    );

    const handleSaveChanges = useCallback(() => {
        if (!activeView) return;
        updateView.mutate(
            { id: activeView.id, payload: captureViewPayload(listState) },
            {
                onSuccess: () =>
                    toast.success(intl.formatMessage(messages.viewSaved)),
                onError: () =>
                    toast.error(intl.formatMessage(messages.viewSaveFailed))
            }
        );
    }, [activeView, updateView, listState, intl]);

    const handleDeleteView = useCallback(
        (view: SavedView) => {
            deleteView.mutate(view.id, {
                onSuccess: () => {
                    // The view is gone; the slice it produced is still on
                    // screen, so drop only the pointer rather than resetting
                    // the table under the user.
                    updateParams({ [VIEW_PARAM]: undefined }, false);
                    toast.success(intl.formatMessage(messages.viewDeleted));
                },
                onError: () =>
                    toast.error(intl.formatMessage(messages.viewDeleteFailed))
            });
        },
        [deleteView, updateParams, intl]
    );

    const handleSetDefault = useCallback(
        (view: SavedView, isDefault: boolean) => {
            setDefaultView.mutate(
                { id: view.id, isDefault },
                {
                    // Worth a toast even though the menu's own label flips:
                    // setting a default changes what happens on the *next*
                    // visit, so nothing on this screen moves to confirm it —
                    // the one case where a silent success reads as a dead
                    // menu item. Naming the view also covers the exclusivity:
                    // pointing the default at one view unsets another.
                    onSuccess: () =>
                        toast.success(
                            isDefault
                                ? intl.formatMessage(messages.viewDefaultSet, {
                                      name: view.name
                                  })
                                : intl.formatMessage(
                                      messages.viewDefaultCleared
                                  )
                        ),
                    onError: () =>
                        toast.error(
                            intl.formatMessage(messages.viewDefaultFailed)
                        )
                }
            );
        },
        [setDefaultView, intl]
    );

    // Which view the reader lands on, resolved on every **arrival**:
    //
    //   1. `?view=<id>` with no competing slice params → apply that view. This
    //      is what makes `?view=` a complete address rather than a label: a
    //      bare pointer used to arrive reading "Modified", because the trigger
    //      named a view whose slice was nowhere in the URL.
    //   2. Any slice param present (`filter`/`sort`/`pageSize`) → leave the URL
    //      alone. The link carried a deliberate deviation, and with a `?view=`
    //      beside it that deviation is exactly the modified state.
    //   3. Otherwise → the reader's default view, if they have one.
    //
    // `q` and `page` sit outside the payload, so they never block a named view
    // — "this view, and I was searching in it" is a coherent link. They do
    // block the **default** in step 3: someone who sent a search of the plain
    // list did not mean to send someone else's saved slice.
    //
    // **Every arrival, not once per mount.** This route is `:typeName`, one
    // element for every collection, so React Router keeps this component
    // mounted across the two navigations that matter most here: the sidebar
    // link back to the list you are already on, and the sidebar link to a
    // different collection. A one-shot ref meant a default only ever applied on
    // a full page load — set one, click the collection in the sidebar, and the
    // plain list came back.
    //
    // What separates an arrival from the reader's own moves is the navigation
    // type: `updateParams` and `applyView` always **replace**, so picking
    // "All records" stays picked, while a `<Link>` (PUSH) or Back (POP) re-arms
    // the ladder.
    const navigationType = useNavigationType();
    // The view id last expanded into the URL from a bare `?view=`. Without it a
    // view whose payload sets no params at all — no filter, no sort, default
    // page size — would fail the step-2 check forever and re-apply on every
    // render.
    const hydratedView = useRef<string | null>(null);
    useEffect(() => {
        if (!viewsEnabled || viewsPending) return;
        const named = viewParam
            ? views.find((view) => view.id === viewParam)
            : undefined;
        if (named) {
            const key = `${scope}|${named.id}`;
            if (
                hydratedView.current !== key &&
                !hasPayloadParams(searchParams)
            ) {
                hydratedView.current = key;
                applyView(named);
            }
            return;
        }
        // A `?view=` naming something this reader can't see (renamed, deleted,
        // unshared) is still an explicit address: show the plain list rather
        // than substituting a personal default for it.
        if (viewParam) return;
        if (hasAnyListParams(searchParams)) return;
        if (navigationType === NavigationType.Replace) return;
        const fallback = views.find((view) => view.isDefault);
        if (fallback) {
            hydratedView.current = `${scope}|${fallback.id}`;
            applyView(fallback);
        }
    }, [
        viewsEnabled,
        viewsPending,
        views,
        viewParam,
        searchParams,
        navigationType,
        scope,
        applyView
    ]);

    // The inline filter panel: its own open state (the toolbar button toggles
    // it), with the ids wiring the button's `aria-controls` to the region.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersPanelId = useId();
    const filtersToggleId = useId();
    const filtersToggleRef = useRef<HTMLButtonElement>(null);
    // Return focus to the toggle when the panel collapses (Apply / Esc), so the
    // now-`inert` panel doesn't strand focus on the body.
    const setFiltersPanelOpen = useCallback((open: boolean) => {
        setFiltersOpen(open);
        if (!open) filtersToggleRef.current?.focus();
    }, []);

    const entries = data?.items ?? [];
    const hasFilters = searchInput.trim().length > 0 || ruleCount > 0;

    // Per-page data for the extension columns: every registered item's
    // `useRowsData` runs on every render (boot-frozen items → stable hook
    // order; items gate their own fetching internally), keyed by item id for
    // the table's cells.
    //
    // Whether the column is switched on is passed **in** rather than used to
    // skip the call — skipping would change hook order between renders. Every
    // extension column is off by default, so an item that ignores this fetches
    // for a column that is never drawn.
    const extensionData: Record<string, unknown> = {};
    for (const item of extensionColumnItems) {
        extensionData[item.id] = item.useRowsData?.(
            entries,
            schema,
            workspace.id,
            isVisible(item.id)
        );
    }

    const clearFilters = () => {
        setSearchInput('');
        updateParams({ [SEARCH_PARAM]: undefined, filter: undefined });
    };

    // The slot-owned URL params (e.g. the active locale) as a query suffix, so
    // every link out of the table keeps the context the table was showing — the
    // create route below and each row's editor link (passed to the table), whose
    // editor in turn carries it back on "Back to records".
    const entryQuery = listParamsQuery(slotParams);

    const openCreate = () => {
        navigate(`${typePath}/${NEW_SEGMENT}${entryQuery}`);
    };

    return (
        <Container className="max-w-none p-6 sm:p-6">
            <ContainerHeader
                // The same mark the sidebar puts on this type, so the heading
                // and the row that led here read as one place — and the trash
                // bin when the list is the trash view, which is a different
                // set of records under the same type's name.
                icon={
                    trashed ? (
                        <Trash2 className="size-4" />
                    ) : schema.kind === CONTENT_TYPE_KIND.Collection ? (
                        <Table2 className="size-4" />
                    ) : (
                        <FileText className="size-4" />
                    )
                }
                title={
                    trashed
                        ? intl.formatMessage(messages.trashTitle, {
                              label: schema.label
                          })
                        : schema.label
                }
                subtitle={intl.formatMessage(
                    trashed ? messages.trashSubtitle : messages.subtitle,
                    { count: total }
                )}
                actions={
                    trashed ? (
                        <Button
                            variant="outline"
                            className="shadow-none"
                            asChild
                        >
                            <Link to={typePath}>
                                <ArrowLeft />
                                {intl.formatMessage(messages.backToRecords)}
                            </Link>
                        </Button>
                    ) : (
                        // The header carries what you do **to** the
                        // collection, and only that: one primary action and the
                        // ⋯ for the rare ones. Everything that changes *which
                        // records you are looking at* — the saved view, the
                        // locale, the columns, the filters — sits on the
                        // toolbar row below, next to the search box it belongs
                        // with. Two right-aligned rows of identical outline
                        // buttons gave no clue which was which.
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {canCreate ? (
                                <Button onClick={openCreate}>
                                    <Plus />
                                    {intl.formatMessage(messages.add)}
                                </Button>
                            ) : null}
                            <CollectionRecordsMenu
                                schema={schema}
                                workspaceId={workspace.id}
                                trashed={trashed}
                                trashHref={
                                    paranoid && canDelete
                                        ? `${typePath}/${TRASH_SEGMENT}`
                                        : undefined
                                }
                            />
                        </div>
                    )
                }
            />

            {/* A view outlives the field it was saved over, so applying one
                drops what no longer exists. Say so — a silently shorter table
                reads as a bug in the view, not as a changed content type. It is
                a full-width line under the header rather than part of the
                switcher: a wrapping sentence inside a right-aligned row of
                buttons would push them around every time a stale view loads. */}
            {droppedColumns > 0 ? (
                <p
                    className="-mt-2 mb-4 text-sm text-muted-foreground"
                    role="status"
                >
                    {intl.formatMessage(messages.viewDroppedColumns, {
                        count: droppedColumns
                    })}
                </p>
            ) : null}

            <SearchToolbar
                value={searchInput}
                onValueChange={setSearchInput}
                busy={searchPending || (isFetching && !isPending)}
                searchLabel={intl.formatMessage(messages.searchLabel)}
                searchPlaceholder={intl.formatMessage(
                    messages.searchPlaceholder
                )}
                actions={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* The switcher leads the row: it says *which slice* the
                            controls beside it are narrowing. Rendered only once
                            the views request has settled — a control that says
                            "All records" before we know whether any views exist
                            flashes a label that may be about to change, and on
                            an error there is nothing truthful to show. */}
                        {viewsEnabled && !viewsPending && !viewsError ? (
                            <ViewSwitcher
                                views={views}
                                active={activeView}
                                isDirty={viewIsDirty}
                                isSaving={updateView.isPending}
                                onSelect={applyView}
                                onSaveAs={() => {
                                    setSaveViewError(null);
                                    setSaveViewOpen(true);
                                }}
                                onSaveChanges={handleSaveChanges}
                                onReset={() =>
                                    activeView
                                        ? applyView(activeView)
                                        : undefined
                                }
                                onSetDefault={handleSetDefault}
                                onDelete={handleDeleteView}
                            />
                        ) : null}
                        {toolbarItems.map((item) => (
                            <item.Component
                                key={item.id}
                                schema={schema}
                                workspaceId={workspace.id}
                                params={slotParams}
                                updateParams={updateParams}
                            />
                        ))}
                        <CollectionRecordsColumnPicker
                            columns={columns}
                            visible={visible}
                            isVisible={isVisible}
                            onToggle={toggle}
                            onReorder={reorder}
                            visibleCount={visible.length}
                        />
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
                    </div>
                }
            />

            {/* The filter builder, inline between the toolbar and the table. It
                pushes the table down when open (no overlay); collapsed with
                active filters, the applied conditions read out as removable
                chips below. */}
            <QueryBuilderPanel
                id={filtersPanelId}
                labelledBy={filtersToggleId}
                open={filtersOpen}
                onOpenChange={setFiltersPanelOpen}
                fields={filterFields}
                value={appliedFilter}
                onApply={applyFilter}
                onApplied={() => setApplying(true)}
                fieldsPending={filterFieldsPending}
                fieldsError={filterFieldsError}
                onRetryFields={refetchFilterFields}
                renderRelationValue={(props) => (
                    <RelationValuePicker {...props} />
                )}
            />
            {!filtersOpen && appliedFilter && ruleCount > 0 ? (
                <QueryBuilderSummary
                    className="mb-4"
                    tree={appliedFilter}
                    fields={filterFields}
                    onChange={applyFilter}
                />
            ) : null}

            {/* Always-mounted live region so a search/filter/sort that updates
                the table without a navigation is actually announced — a region
                that first mounts already populated is not announced. Carries the
                loading cue and the result count (WCAG 4.1.3); the error path is
                announced by the Alert's role="alert" below. */}
            <p role="status" aria-live="polite" className="sr-only">
                {isPending
                    ? intl.formatMessage(messages.loading)
                    : isError
                      ? ''
                      : `${intl.formatMessage(messages.results, {
                            count: total
                        })} ${viewStatus} ${sortStatus}`}
            </p>

            {/* Persistent selection announcer — present from first render so the
                transition to "{n} selected" and back to "No rows selected" is
                announced; the visual SelectionBar mounts only when something is
                selected, so it can't carry this. */}
            <p role="status" aria-live="polite" className="sr-only">
                {intl.formatMessage(messages.selectionStatus, {
                    count: selectedIds.size
                })}
            </p>

            {isPending || ((applying || paging) && isFetching) ? (
                <CollectionRecordsSkeleton />
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
            ) : entries.length === 0 ? (
                <CollectionRecordsEmpty
                    filtered={hasFilters}
                    trashed={trashed}
                    onClear={clearFilters}
                    onAdd={trashed || !canCreate ? undefined : openCreate}
                />
            ) : (
                <>
                    {selectedIds.size > 0 && (
                        <CollectionRecordsSelectionBar
                            count={selectedIds.size}
                            onClear={clearSelection}
                            actions={
                                <CollectionRecordsBulkActions
                                    typeName={type.name}
                                    schema={schema}
                                    workspaceId={workspace.id}
                                    ids={[...selectedIds]}
                                    publishable={publishable}
                                    paranoid={paranoid}
                                    trashed={trashed}
                                    onDone={clearSelection}
                                />
                            }
                        />
                    )}
                    <CollectionRecordsTable
                        label={schema.label}
                        entries={entries}
                        columns={visibleColumns}
                        extensionData={extensionData}
                        typePath={typePath}
                        entryQuery={entryQuery}
                        typeName={type.name}
                        workspaceId={workspace.id}
                        publishable={publishable}
                        paranoid={paranoid}
                        trashed={trashed}
                        selectedIds={selectedIds}
                        onToggleRow={toggleRow}
                        onTogglePage={setPageSelection}
                        onRowGone={forgetRow}
                        sort={sort}
                        onSort={handleSort}
                        relationsPending={isPlaceholderData}
                    />
                    <CollectionRecordsPagination
                        page={page}
                        pageCount={pageCount}
                        pageSize={effectivePageSize}
                        total={total}
                        onPageChange={(next) => {
                            setPaging(true);
                            updateParams({ page: String(next) }, false);
                        }}
                        onPageSizeChange={(next) => {
                            setPaging(true);
                            updateParams({ pageSize: String(next) });
                        }}
                    />
                </>
            )}

            <SaveViewDialog
                open={saveViewOpen}
                onOpenChange={setSaveViewOpen}
                collectionLabel={schema.label}
                payload={captureViewPayload(listState)}
                ruleCount={ruleCount}
                sortLabel={sortedColumn ? columnLabel(sortedColumn) : null}
                canShare={canShareViews}
                isSaving={saveView.isPending}
                errorStatus={saveViewError}
                onSubmit={handleSaveNew}
            />
        </Container>
    );
}

/**
 * Whether the URL carries any param a view's **payload** would set.
 *
 * These are the ones that can disagree with a saved slice, so their presence
 * beside a `?view=` is the modified state rather than something to overwrite.
 * `page` and `q` are deliberately absent — neither is captured in a payload, so
 * neither can contradict one.
 */
function hasPayloadParams(params: URLSearchParams): boolean {
    return ['filter', SORT_PARAM, 'pageSize'].some(
        (key) => params.get(key) !== null
    );
}

/**
 * Whether the URL says anything at all about what to show — the wider set that
 * blocks the reader's **default** view.
 *
 * `q` is in here on purpose: arriving with a search means the sender was
 * looking at search results of the plain list, and swapping in a personal
 * default would answer a question nobody asked.
 */
function hasAnyListParams(params: URLSearchParams): boolean {
    return (
        hasPayloadParams(params) ||
        ['page', SEARCH_PARAM].some((key) => params.get(key) !== null)
    );
}

/** The HTTP status behind a gateway error, when it carried one. */
function readStatus(error: unknown): number | null {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : null;
}
