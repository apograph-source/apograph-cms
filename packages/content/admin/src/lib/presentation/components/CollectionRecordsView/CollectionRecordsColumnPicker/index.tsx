import { useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Columns3 } from 'lucide-react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type Announcements,
    type DragEndEvent,
    type ScreenReaderInstructions
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import {
    Button,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@orthacms/design-system';
import type { EntryColumn } from '../../../../domain/entryColumns';
import { useColumnLabel } from '../../../hooks/useColumnLabel';
import { ColumnRow } from './ColumnRow';
import { SortableColumnRow } from './SortableColumnRow';

/** Intl descriptors for {@link CollectionRecordsColumnPicker}, co-located. */
const messages = defineMessages({
    trigger: {
        id: 'content.records.columns.trigger',
        defaultMessage: 'Columns'
    },
    heading: {
        id: 'content.records.columns.heading',
        defaultMessage: 'Toggle and reorder columns'
    },
    dndInstructions: {
        id: 'content.records.columns.dnd.instructions',
        defaultMessage:
            'To reorder a column, press Space or Enter to pick it up, use the arrow keys to move it, then press Space or Enter again to drop it, or Escape to cancel.'
    },
    dndPickedUp: {
        id: 'content.records.columns.dnd.pickedUp',
        defaultMessage: 'Picked up the {column} column.'
    },
    dndOver: {
        id: 'content.records.columns.dnd.over',
        defaultMessage: 'The {column} column was moved over {target}.'
    },
    dndDropped: {
        id: 'content.records.columns.dnd.dropped',
        defaultMessage: 'The {column} column was dropped over {target}.'
    },
    dndCancelled: {
        id: 'content.records.columns.dnd.cancelled',
        defaultMessage:
            'Reordering cancelled. The {column} column returned to its position.'
    },
    searchLabel: {
        id: 'content.records.columns.searchLabel',
        defaultMessage: 'Search columns'
    },
    searchPlaceholder: {
        id: 'content.records.columns.searchPlaceholder',
        defaultMessage: 'Search columns…'
    },
    searchEmpty: {
        id: 'content.records.columns.searchEmpty',
        defaultMessage: 'No column found.'
    },
    searchResults: {
        id: 'content.records.columns.searchResults',
        defaultMessage:
            '{count, plural, =0 {No columns found} one {# column} other {# columns}}'
    }
});

/** Case-insensitive label match for the column search. */
function matches(label: string, query: string): boolean {
    return label.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * The column-visibility + ordering control: a popover listing every available
 * column. Visible columns come first as **drag-and-drop / keyboard reorderable**
 * rows (the order is the table's display order); hidden columns follow as plain
 * toggles. Visibility and order are owned by `useEntryColumns` (component state
 * for the session, not persisted), so this is a thin controlled view over
 * `visible`/`toggle`/`reorder`. A
 * column can't be hidden if it's the last one standing, so the table never blanks.
 */
export function CollectionRecordsColumnPicker({
    columns,
    visible,
    isVisible,
    onToggle,
    onReorder,
    visibleCount
}: {
    /** Every available column. */
    columns: EntryColumn[];
    /** Visible column ids, in display order. */
    visible: string[];
    /** Whether a column id is currently shown. */
    isVisible: (id: string) => boolean;
    /** Toggle a column's visibility. */
    onToggle: (id: string) => void;
    /** Move the `active` column to the `over` column's position. */
    onReorder: (activeId: string, overId: string) => void;
    /** How many columns are currently visible (to guard the last one). */
    visibleCount: number;
}) {
    const intl = useIntl();
    const labelOf = useColumnLabel();
    // Radix gives the popover `role="dialog"`, and it had no accessible name —
    // a screen reader announced a bare "dialog" and the user had no idea what
    // they had entered (`ORT-169`). The heading it already renders is the name;
    // this ties the two together rather than duplicating the string into an
    // `aria-label` that could drift from it.
    const headingId = useId();
    const [query, setQuery] = useState('');
    const searching = query.trim().length > 0;
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );

    const byId = new Map(columns.map((column) => [column.id, column]));
    // Visible columns in persisted display order; hidden ones keep schema order.
    const allVisibleColumns = visible
        .map((id) => byId.get(id))
        .filter((column): column is EntryColumn => column !== undefined);
    const allHiddenColumns = columns.filter((column) => !isVisible(column.id));

    // The full column set is already in memory (it comes from the schema), so
    // the search filters locally — no request, like the locale switcher.
    const visibleColumns = searching
        ? allVisibleColumns.filter((column) => matches(labelOf(column), query))
        : allVisibleColumns;
    const hiddenColumns = searching
        ? allHiddenColumns.filter((column) => matches(labelOf(column), query))
        : allHiddenColumns;
    const noMatches =
        searching && visibleColumns.length === 0 && hiddenColumns.length === 0;

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            onReorder(String(active.id), String(over.id));
        }
    };

    // Spoken feedback for keyboard reordering. dnd-kit ships English defaults
    // keyed by raw id; these announce the column *labels* and localize.
    const labelFor = (id: string | number): string => {
        const column = byId.get(String(id));
        return column ? labelOf(column) : String(id);
    };
    const announcements: Announcements = {
        onDragStart: ({ active }) =>
            intl.formatMessage(messages.dndPickedUp, {
                column: labelFor(active.id)
            }),
        onDragOver: ({ active, over }) =>
            over
                ? intl.formatMessage(messages.dndOver, {
                      column: labelFor(active.id),
                      target: labelFor(over.id)
                  })
                : undefined,
        onDragEnd: ({ active, over }) =>
            over
                ? intl.formatMessage(messages.dndDropped, {
                      column: labelFor(active.id),
                      target: labelFor(over.id)
                  })
                : undefined,
        onDragCancel: ({ active }) =>
            intl.formatMessage(messages.dndCancelled, {
                column: labelFor(active.id)
            })
    };
    const screenReaderInstructions: ScreenReaderInstructions = {
        draggable: intl.formatMessage(messages.dndInstructions)
    };

    // Reordering is suppressed while searching: the rows on screen are a subset,
    // so dropping one onto another would move it to a position the user can't
    // see — and a `SortableContext` whose `items` include unrendered ids
    // misbehaves. Visible rows stay toggleable, just not draggable.
    const visibleRows = visibleColumns.map((column) =>
        searching ? (
            <ColumnRow
                key={column.id}
                column={column}
                label={labelOf(column)}
                checked
                disabled={visibleCount <= 1}
                onToggle={() => onToggle(column.id)}
                // Spacer keeps the checkbox aligned with the draggable rows.
                handle={<span className="w-5 shrink-0" />}
            />
        ) : (
            <SortableColumnRow
                key={column.id}
                column={column}
                label={labelOf(column)}
                // Keep at least one column so the table never blanks.
                disabled={visibleCount <= 1}
                onToggle={() => onToggle(column.id)}
            />
        )
    );

    return (
        <Popover
            // Start each visit from the full list rather than the previous
            // search.
            onOpenChange={(open) => {
                if (!open) setQuery('');
            }}
        >
            <PopoverTrigger asChild>
                <Button variant="outline" className="shadow-none">
                    <Columns3 aria-hidden className="size-4" />
                    {intl.formatMessage(messages.trigger)}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-64 p-2"
                aria-labelledby={headingId}
            >
                <p
                    id={headingId}
                    className="px-1 py-1.5 text-xs font-medium text-muted-foreground"
                >
                    {intl.formatMessage(messages.heading)}
                </p>
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                    aria-label={intl.formatMessage(messages.searchLabel)}
                    className="mb-1 h-8 rounded-lg shadow-none"
                />
                {/* Filtering is instant and otherwise silent — without this a
                    screen-reader user types and hears nothing back, neither a
                    result count nor the empty state. */}
                <p aria-live="polite" className="sr-only">
                    {searching
                        ? intl.formatMessage(messages.searchResults, {
                              count:
                                  visibleColumns.length + hiddenColumns.length
                          })
                        : ''}
                </p>
                {/* Only the list scrolls, so the search box stays put. */}
                <div className="max-h-72 overflow-y-auto">
                    {noMatches ? (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                            {intl.formatMessage(messages.searchEmpty)}
                        </p>
                    ) : null}
                    {searching ? (
                        visibleRows
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                            accessibility={{
                                announcements,
                                screenReaderInstructions
                            }}
                        >
                            <SortableContext
                                items={visible}
                                strategy={verticalListSortingStrategy}
                            >
                                {visibleRows}
                            </SortableContext>
                        </DndContext>
                    )}
                    {hiddenColumns.length > 0 && (
                        <>
                            {visibleColumns.length > 0 && (
                                <div
                                    className="my-1 h-px bg-border"
                                    role="separator"
                                />
                            )}
                            {hiddenColumns.map((column) => (
                                <ColumnRow
                                    key={column.id}
                                    column={column}
                                    label={labelOf(column)}
                                    checked={false}
                                    onToggle={() => onToggle(column.id)}
                                    // Spacer aligns the checkbox with the dragged rows.
                                    handle={<span className="w-5 shrink-0" />}
                                />
                            ))}
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
