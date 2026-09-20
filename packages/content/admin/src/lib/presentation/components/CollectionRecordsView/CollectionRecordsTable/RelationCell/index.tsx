import { defineMessages, useIntl } from 'react-intl';
import { ChevronDown } from 'lucide-react';
import {
    Badge,
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@orthacms/design-system';
import type {
    ContentField,
    RelationFieldView
} from '../../../../../domain/types/contentType';
import { RelationCellList } from './RelationCellList';

/** Co-located labels for the relation cell's trigger. */
const messages = defineMessages({
    // The visible text (the first linked record's title) must be a prefix of
    // the accessible name — WCAG 2.5.3 Label in Name. Naming the button
    // "Show 3 linked records for Author" instead would leave a voice-control
    // user unable to activate the control they can see.
    trigger: {
        id: 'content.records.relation.trigger',
        defaultMessage:
            '{title}{overflow, plural, =0 {} other { +# more}} — {field}, show linked records'
    },
    empty: {
        id: 'content.records.relation.empty',
        defaultMessage: 'No linked records'
    },
    unavailable: {
        id: 'content.records.relation.unavailable',
        defaultMessage: 'Unavailable record'
    },
    listLabel: {
        id: 'content.records.relation.listLabel',
        defaultMessage: 'Records linked through {field}'
    }
});

/** The em-dash placeholder shown when a relation holds nothing. */
const EMPTY = '—';

/**
 * Marks a relation cell's trigger so an open dropdown can recognise a click on
 * *another* cell's trigger and leave that transition to the table.
 */
const TRIGGER_ATTR = 'data-relation-trigger';

/**
 * A relation column's cell: a titled trigger (the first linked record plus a
 * `+N` overflow) opening a popover of the linked records, each a link to that
 * record's own editor in a new tab.
 *
 * The collapsed state renders entirely from the list response's capped
 * `preview`, so it costs no request. The popover's contents live in
 * {@link RelationCellList}, which is mounted only while open — that is what
 * keeps a page of 50 relation cells from registering 50 idle link queries.
 *
 * **Open state is owned by the table**, not this cell: the table tracks a
 * single open cell, so opening one dropdown closes any other (classic dropdown
 * semantics). Per-cell state would let two cells be open at once — Radix's
 * outside-dismiss doesn't coordinate independent popovers.
 */
export function RelationCell({
    field,
    preview,
    typeName,
    recordId,
    workspaceId,
    open,
    onOpenChange,
    relationsPending
}: {
    /** The relation field this column renders. */
    field: ContentField;
    /** The server's capped preview for this row + field, if any. */
    preview: RelationFieldView | undefined;
    /**
     * Whether the rows on screen are placeholder data from a previous query
     * key. An absent `preview` then means "not fetched yet" rather than "no
     * links", and the cell must not claim the relation is empty.
     */
    relationsPending: boolean;
    /** Machine name of the type being listed (for the links query). */
    typeName: string;
    /** The row's entry id (the link owner). */
    recordId: string;
    /** Open workspace, for building the related record's path. */
    workspaceId: string;
    /** Whether this cell is the table's currently open dropdown. */
    open: boolean;
    /** Report this cell opening or closing; the table owns which one is open. */
    onOpenChange: (open: boolean) => void;
}) {
    const intl = useIntl();

    const target = field.relation?.to;
    const items = preview?.items ?? [];
    const total = preview?.total ?? 0;

    if (!target) {
        return (
            <span className="text-muted-foreground" aria-hidden>
                {EMPTY}
            </span>
        );
    }

    // The list keeps the previous page on screen while a new one loads
    // (`keepPreviousData`). Those rows were fetched *before* this column was
    // enabled, so they carry no preview at all — which is "not loaded yet", not
    // "no links". Claiming the latter would tell a screen-reader user a record
    // has no relations when it may have many.
    if (!preview && relationsPending) {
        return (
            <span
                className="inline-block h-4 w-16 rounded bg-muted/60 align-middle"
                aria-hidden
            />
        );
    }

    if (total === 0) {
        return (
            <span className="text-muted-foreground">
                <span aria-hidden>{EMPTY}</span>
                <span className="sr-only">
                    {intl.formatMessage(messages.empty)}
                </span>
            </span>
        );
    }

    // A preview whose target no longer resolves is id-only; show that rather
    // than the bare uuid the ref carries as its stand-in title.
    const firstTitle = items[0]?.missing
        ? intl.formatMessage(messages.unavailable)
        : (items[0]?.title ?? EMPTY);

    /**
     * A dismissal caused by another relation trigger is left to the table,
     * which closes this cell by opening that one. Radix defers such a dismissal
     * to the click, so letting it through would close the popover that click
     * just opened.
     */
    const isTriggerDismissal = (originalEvent: {
        target: EventTarget | null;
    }) =>
        Boolean(
            (originalEvent.target as HTMLElement | null)?.closest?.(
                `[${TRIGGER_ATTR}]`
            )
        );

    const label = field.admin['label'];
    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    {...{ [TRIGGER_ATTR]: '' }}
                    // The row navigates on click — never let it through.
                    onClick={(event) => event.stopPropagation()}
                    className="-mx-2 h-7 max-w-full gap-1.5 px-2 font-normal"
                    aria-label={intl.formatMessage(messages.trigger, {
                        title: firstTitle,
                        overflow: total - 1,
                        field: typeof label === 'string' ? label : field.name
                    })}
                >
                    <span className="truncate">{firstTitle}</span>
                    {total > 1 ? (
                        <Badge variant="secondary">+{total - 1}</Badge>
                    ) : null}
                    <ChevronDown
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                    />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-72 p-1"
                aria-label={intl.formatMessage(messages.listLabel, {
                    field: typeof label === 'string' ? label : field.name
                })}
                onClick={(event) => event.stopPropagation()}
                onPointerDownOutside={(event) => {
                    if (isTriggerDismissal(event.detail.originalEvent))
                        event.preventDefault();
                }}
                onFocusOutside={(event) => {
                    if (isTriggerDismissal(event.detail.originalEvent))
                        event.preventDefault();
                }}
            >
                <RelationCellList
                    field={field}
                    target={target}
                    preview={preview}
                    typeName={typeName}
                    recordId={recordId}
                    workspaceId={workspaceId}
                />
            </PopoverContent>
        </Popover>
    );
}
