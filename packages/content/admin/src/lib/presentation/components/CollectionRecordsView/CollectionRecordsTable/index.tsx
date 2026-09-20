import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
    Checkbox,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import type { EntryRecord } from '../../../../domain/types/contentType';
import type { EntryColumn } from '../../../../domain/entryColumns';
import { COLUMN_KIND, CONTENT_FIELD_TYPE } from '../../../../domain/constants';
import { EntryStatusBadge } from '../../EntryStatusBadge';
import { renderCell } from './renderCell';
import { RelationCell } from './RelationCell';
import { CollectionRecordsRowActions } from './CollectionRecordsRowActions';
import { useColumnLabel } from '../../../hooks/useColumnLabel';

/** The current table sort: a column id and direction, or none. */
export type TableSort = { key: string; dir: 'asc' | 'desc' } | null;

/** Intl descriptors for {@link CollectionRecordsTable}, co-located. */
const messages = defineMessages({
    actions: {
        id: 'content.records.column.actions',
        defaultMessage: 'Actions'
    },
    caption: {
        id: 'content.records.table.caption',
        defaultMessage: '{label} records'
    },
    selectAll: {
        id: 'content.records.selectAll',
        defaultMessage: 'Select all rows on this page'
    },
    selectRow: {
        id: 'content.records.selectRow',
        defaultMessage: 'Select {label}'
    },
    sortBy: {
        id: 'content.records.sortBy',
        defaultMessage: 'Sort by {column}'
    },
    openRecord: {
        id: 'content.records.openRecord',
        defaultMessage: 'Open {label}'
    }
});

/**
 * A short label identifying a row for its selection checkbox's accessible name:
 * the first visible field's text/number value, falling back to the record id —
 * so each checkbox reads distinctly instead of a column of identical "Select
 * row" controls a screen-reader user can't tell apart.
 */
function rowLabel(record: EntryRecord, columns: EntryColumn[]): string {
    const firstField = columns.find(
        (column) => column.kind === COLUMN_KIND.Field
    );
    if (firstField) {
        const value = record.values[firstField.id];
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number') return String(value);
    }
    return record.id;
}

/**
 * True for a column that renders its own interactive controls (buttons, links).
 * Such a cell must never be wrapped in the row's `<Link>` — nesting an `<a>`
 * inside an `<a>` is invalid HTML and breaks keyboard activation.
 */
function isInteractiveColumn(column: EntryColumn): boolean {
    return (
        column.kind === COLUMN_KIND.Extension ||
        (column.kind === COLUMN_KIND.Field &&
            column.field.type === CONTENT_FIELD_TYPE.Relation)
    );
}

/**
 * Identifies one relation cell (a row × column pair) — the table tracks a single
 * open key so that at most one relation dropdown is ever open.
 */
function relationKey(recordId: string, columnId: string): string {
    return `${recordId}::${columnId}`;
}

/** The cell content for one column of one record. */
function Cell({
    column,
    record,
    extensionData,
    typePath,
    typeName,
    workspaceId,
    openRelation,
    onOpenRelation,
    relationsPending
}: {
    column: EntryColumn;
    record: EntryRecord;
    /** Whether the rows on screen are placeholder data from a previous query. */
    relationsPending: boolean;
    /** Per-item page data from the extension columns' `useRowsData`, by item id. */
    extensionData: Record<string, unknown>;
    /** Absolute path to the open type, for extension cells that navigate. */
    typePath: string;
    /** Machine name of the open type (relation cells query links by it). */
    typeName: string;
    /** Open workspace, for a relation cell's deep links. */
    workspaceId: string;
    /** Key of the table's currently open relation dropdown, if any. */
    openRelation: string | null;
    /** Report a relation cell opening (`true`) or closing (`false`). */
    onOpenRelation: (key: string, next: boolean) => void;
}) {
    const intl = useIntl();
    switch (column.kind) {
        case COLUMN_KIND.Status:
            return <EntryStatusBadge entry={record} />;
        case COLUMN_KIND.Updated:
            return (
                <span className="text-sm text-muted-foreground">
                    {intl.formatDate(record.updatedAt, { dateStyle: 'medium' })}
                </span>
            );
        case COLUMN_KIND.Extension:
            return (
                <column.item.Cell
                    entry={record}
                    data={extensionData[column.id]}
                    typePath={typePath}
                />
            );
        case COLUMN_KIND.Field:
            // A relation renders a dropdown of its linked records rather than
            // the raw FK the values bag carries.
            if (column.field.type === CONTENT_FIELD_TYPE.Relation) {
                const key = relationKey(record.id, column.id);
                return (
                    <RelationCell
                        field={column.field}
                        preview={record.relations?.[column.id]}
                        typeName={typeName}
                        recordId={record.id}
                        workspaceId={workspaceId}
                        open={openRelation === key}
                        onOpenChange={(next) => onOpenRelation(key, next)}
                        relationsPending={relationsPending}
                    />
                );
            }
            return (
                <>{renderCell(column.field, record.values[column.id], intl)}</>
            );
    }
}

/**
 * The collection's records table, built from the visible {@link EntryColumn}s.
 * A leading, fixed checkbox column drives row selection (header = select-all for
 * the current page, with an indeterminate state). The whole row links to the
 * entry's detail stub, the first data cell holds a real `<a>` for keyboard users,
 * and the checkbox cell stops propagation so selecting doesn't navigate. Header
 * cells carry `scope="col"` and the table an `aria-label`. Column **order** is
 * chosen in the column picker (drag-to-reorder lives there), so the headers here
 * are static.
 */
export function CollectionRecordsTable({
    label,
    entries,
    columns,
    extensionData = {},
    typePath,
    entryQuery = '',
    typeName,
    workspaceId,
    publishable,
    paranoid,
    trashed = false,
    selectedIds,
    onToggleRow,
    onTogglePage,
    onRowGone,
    sort,
    onSort,
    relationsPending = false
}: {
    /** The content type's display label, for the table caption. */
    label: string;
    /** The page of records to render. */
    entries: EntryRecord[];
    /** The visible columns, in display order. */
    columns: EntryColumn[];
    /** Per-item page data from the extension columns' `useRowsData`, by item id. */
    extensionData?: Record<string, unknown>;
    /** Absolute path to this type, e.g. `/workspaces/:id/content/:typeName`. */
    typePath: string;
    /**
     * The table's slot-owned list params as a query suffix (e.g. `"?locale=de"`),
     * appended to every row's editor link so the record opens in — and returns
     * to — the context the table was showing.
     */
    entryQuery?: string;
    /** The content type's machine name (for the row action mutations). */
    typeName: string;
    /** Open workspace id, for a relation cell's deep links to related records. */
    workspaceId: string;
    /** Whether the type has a publish workflow (drives the row Publish/Unpublish action). */
    publishable: boolean;
    /** Whether the type soft-deletes (drives the row delete copy + Restore). */
    paranoid: boolean;
    /** Whether this is the trash view (rows aren't editable; trash row actions). */
    trashed?: boolean;
    /** Currently selected record ids. */
    selectedIds: Set<string>;
    /** Toggle one row's selection. */
    onToggleRow: (id: string) => void;
    /** Select or clear every row on the current page. */
    onTogglePage: (ids: string[], select: boolean) => void;
    /**
     * A row left this view (deleted, purged, restored from trash). The parent
     * drops the id from its selection and takes over focus placement — Radix
     * would otherwise try to restore focus into a menu that has unmounted.
     */
    onRowGone?: (id: string) => void;
    /** The active sort column + direction, or null for default order. */
    sort: TableSort;
    /** Cycle the sort on a column (asc → desc → off). */
    onSort: (columnId: string) => void;
    /**
     * Whether these rows are placeholder data from a previous query key, so a
     * relation cell with no preview must not read as "no linked records".
     */
    relationsPending?: boolean;
}) {
    const intl = useIntl();
    const navigate = useNavigate();
    const columnLabel = useColumnLabel();
    // One open relation dropdown at a time (classic dropdown semantics): the
    // table owns which cell is open, so opening one closes any other in the
    // same update. Radix does not coordinate independent popovers, so per-cell
    // state would let several stay open at once. A close only clears the key
    // when that cell is still the open one — Radix dismisses the previously
    // open popover *after* the click that opened the next, so an unconditional
    // clear would immediately wipe the cell the user just opened.
    const [openRelation, setOpenRelation] = useState<string | null>(null);
    const handleOpenRelation = useCallback((key: string, next: boolean) => {
        setOpenRelation((current) =>
            next ? key : current === key ? null : current
        );
    }, []);

    // Where the row's record link lives. It can't be a cell that renders its
    // own interactive content (a relation dropdown, an extension badge) — an
    // `<a>` inside an `<a>` is invalid and breaks keyboard activation — so it
    // is the first column that *can* carry it, not simply the first column.
    // Pinning it to index 0 would drop the link entirely whenever a relation
    // sorts first, leaving keyboard users only the row-actions Edit item.
    const linkColumnIndex = columns.findIndex(
        (column) => !isInteractiveColumn(column)
    );

    const pageIds = entries.map((record) => record.id);
    const allSelected =
        entries.length > 0 && pageIds.every((id) => selectedIds.has(id));
    const someSelected = pageIds.some((id) => selectedIds.has(id));
    const headerChecked = allSelected
        ? true
        : someSelected
          ? 'indeterminate'
          : false;

    const containerRef = useRef<HTMLDivElement>(null);
    // The row's menu — and the confirm dialog opened from it — are gone by the
    // time the mutation settles, so Radix has no live element to restore focus
    // to and drops it on `<body>`: the next Tab restarts above the app sidebar,
    // and a screen-reader user hears the toast and then silence. Land it on the
    // table itself instead, which is labelled and still on screen.
    const handleRowGone = (id: string) => {
        onRowGone?.(id);
        containerRef.current?.focus();
    };

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            aria-label={intl.formatMessage(messages.caption, { label })}
            className="w-full overflow-hidden rounded-xl border bg-card shadow-xs focus-visible:outline-none"
        >
            <Table aria-label={intl.formatMessage(messages.caption, { label })}>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-10">
                            <Checkbox
                                checked={headerChecked}
                                onCheckedChange={(checked) =>
                                    onTogglePage(pageIds, checked === true)
                                }
                                aria-label={intl.formatMessage(
                                    messages.selectAll
                                )}
                            />
                        </TableHead>
                        {columns.map((column) => {
                            const active = sort?.key === column.id;
                            const ariaSort = active
                                ? sort.dir === 'asc'
                                    ? 'ascending'
                                    : 'descending'
                                : 'none';
                            const label = columnLabel(column);
                            // Neither extension columns nor relations are in the
                            // server's sort whitelist (a relation column holds
                            // an FK or no column at all, so a sort would
                            // silently fall back to `updatedAt`) — render a
                            // plain, non-sortable header.
                            if (isInteractiveColumn(column)) {
                                return (
                                    <TableHead key={column.id} scope="col">
                                        {label}
                                    </TableHead>
                                );
                            }
                            return (
                                <TableHead
                                    key={column.id}
                                    scope="col"
                                    aria-sort={ariaSort}
                                >
                                    <button
                                        type="button"
                                        className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        aria-label={intl.formatMessage(
                                            messages.sortBy,
                                            { column: label }
                                        )}
                                        onClick={() => onSort(column.id)}
                                    >
                                        {label}
                                        {active ? (
                                            sort.dir === 'asc' ? (
                                                <ArrowUp
                                                    className="size-3.5"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <ArrowDown
                                                    className="size-3.5"
                                                    aria-hidden
                                                />
                                            )
                                        ) : (
                                            <ArrowUpDown
                                                className="size-3.5 text-muted-foreground/50"
                                                aria-hidden
                                            />
                                        )}
                                    </button>
                                </TableHead>
                            );
                        })}
                        {/* Trailing, non-sortable actions column. */}
                        <TableHead scope="col" className="w-10 text-right">
                            {intl.formatMessage(messages.actions)}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.map((record) => {
                        const selected = selectedIds.has(record.id);
                        return (
                            <TableRow
                                key={record.id}
                                data-state={selected ? 'selected' : undefined}
                                onClick={
                                    trashed
                                        ? undefined
                                        : () =>
                                              navigate(
                                                  `${typePath}/${record.id}${entryQuery}`
                                              )
                                }
                                className={
                                    trashed ? undefined : 'cursor-pointer'
                                }
                            >
                                <TableCell
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <Checkbox
                                        checked={selected}
                                        onCheckedChange={() =>
                                            onToggleRow(record.id)
                                        }
                                        aria-label={intl.formatMessage(
                                            messages.selectRow,
                                            { label: rowLabel(record, columns) }
                                        )}
                                    />
                                    {/* Every visible column renders its own
                                        controls, so no cell can host the row's
                                        link — keep one reachable here rather
                                        than leaving the record openable only
                                        through the row-actions menu. */}
                                    {linkColumnIndex === -1 && !trashed ? (
                                        <Link
                                            to={`${typePath}/${record.id}${entryQuery}`}
                                            className="sr-only"
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            {intl.formatMessage(
                                                messages.openRecord,
                                                {
                                                    label: rowLabel(
                                                        record,
                                                        columns
                                                    )
                                                }
                                            )}
                                        </Link>
                                    ) : null}
                                </TableCell>
                                {columns.map((column, index) => {
                                    const interactive =
                                        isInteractiveColumn(column);
                                    const cell = (
                                        <Cell
                                            column={column}
                                            record={record}
                                            extensionData={extensionData}
                                            typePath={typePath}
                                            typeName={typeName}
                                            workspaceId={workspaceId}
                                            openRelation={openRelation}
                                            onOpenRelation={handleOpenRelation}
                                            relationsPending={relationsPending}
                                        />
                                    );
                                    return (
                                        <TableCell
                                            key={column.id}
                                            // Interactive cells own their clicks
                                            // (an extension badge navigating to
                                            // a sibling record, a relation
                                            // dropdown) — don't let the row
                                            // navigation swallow them.
                                            onClick={
                                                interactive
                                                    ? (event) =>
                                                          event.stopPropagation()
                                                    : undefined
                                            }
                                        >
                                            {index === linkColumnIndex &&
                                            !trashed ? (
                                                <Link
                                                    to={`${typePath}/${record.id}${entryQuery}`}
                                                    className="block hover:underline"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    {cell}
                                                </Link>
                                            ) : (
                                                cell
                                            )}
                                        </TableCell>
                                    );
                                })}
                                {/* Row actions — stop propagation so opening the
                                    menu doesn't trigger the row's navigation. */}
                                <TableCell
                                    className="text-right"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <CollectionRecordsRowActions
                                        record={record}
                                        typePath={typePath}
                                        entryQuery={entryQuery}
                                        typeName={typeName}
                                        publishable={publishable}
                                        paranoid={paranoid}
                                        trashed={trashed}
                                        rowTitle={rowLabel(record, columns)}
                                        onRowGone={handleRowGone}
                                    />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
