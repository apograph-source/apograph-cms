import type { CSSProperties, ReactNode, Ref } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import { Badge, Button, buttonVariants, cn } from '@orthacms/design-system';
import type { EntryStatus } from '../../../../../../domain/types/contentType';
import { ENTRY_STATUS } from '../../../../../../domain/constants';

/** Co-located labels for the row's status badge and the Replace control. */
const messages = defineMessages({
    statusDraft: {
        id: 'content.relations.row.statusDraft',
        defaultMessage: 'Draft'
    },
    statusPublished: {
        id: 'content.relations.row.statusPublished',
        defaultMessage: 'Published'
    },
    replace: {
        id: 'content.relations.row.replace',
        defaultMessage: 'Replace'
    }
});

/**
 * One assigned related record in the Relations tab — the shared row for a single
 * relation, a many-relation, and the inverse side. Renders a **leading** slot
 * (an initials avatar for a single relation, a `01`/`02` index for an ordered
 * many-relation, or nothing), the title with a muted `/handle`, an optional
 * status badge, and a trailing controls cluster: reorder **up/down** arrows
 * (ordered relations), the drag `handle`, an **open-in-new-tab** link, a
 * **Replace** action (single relation), and remove. Presentational and
 * controlled — the parent owns the value and every callback. Accessible names
 * for the controls are passed in so the parent can interpolate the record title.
 *
 * In a **read-only** editor every write control is dropped rather than disabled
 * — reorder arrows, drag handle, Replace, remove — because there is no state in
 * which they would light up for this reader, and a row of five dead buttons
 * reads as a broken editor rather than a preview. The open-in-a-new-tab link
 * stays: following a link to a record you can read is not a write.
 */
export type RelationItemRowProps = {
    title: string;
    /** URL-ish handle rendered as a muted `/handle` beside the title. */
    handle?: string;
    /** Publish status of the linked record — renders a badge when present. */
    status?: EntryStatus;
    /** Leading visual: an initials avatar (single) or an index chip (many). */
    leading?: ReactNode;
    onRemove: () => void;
    /** Accessible label for the remove button (e.g. "Remove Ada Lovelace"). */
    removeLabel: string;
    /** Deep link to this record's editor; renders an open-in-new-tab control. */
    href?: string;
    /** Accessible label for the open link (e.g. "Open Ada Lovelace in a new tab"). */
    openLabel?: string;
    /** Swap this single-relation link for another (opens the picker). */
    onReplace?: () => void;
    /** Move this row up one place (ordered many-relations only). */
    onMoveUp?: () => void;
    /** Accessible label for the up arrow (e.g. "Move Ada Lovelace up"). */
    moveUpLabel?: string;
    /** Disable the up arrow (the first row). */
    moveUpDisabled?: boolean;
    /** Move this row down one place (ordered many-relations only). */
    onMoveDown?: () => void;
    /** Accessible label for the down arrow (e.g. "Move Ada Lovelace down"). */
    moveDownLabel?: string;
    /** Disable the down arrow (the last row). */
    moveDownDisabled?: boolean;
    /** Drag handle, when the row is reorderable (many-relations only). */
    dragHandle?: ReactNode;
    /** dnd-kit node ref for the sortable wrapper. */
    rowRef?: Ref<HTMLDivElement>;
    /** dnd-kit transform/transition styles while dragging. */
    style?: CSSProperties;
    /** Whether this row is the one being dragged (dims it). */
    dragging?: boolean;
    /**
     * Preview mode — drop every write control (reorder, drag, Replace, remove)
     * and keep the record's identity and its open-in-a-new-tab link.
     */
    readOnly?: boolean;
};

export function RelationItemRow({
    title,
    handle,
    status,
    leading,
    onRemove,
    removeLabel,
    href,
    openLabel,
    onReplace,
    onMoveUp,
    moveUpLabel,
    moveUpDisabled = false,
    onMoveDown,
    moveDownLabel,
    moveDownDisabled = false,
    dragHandle,
    rowRef,
    style,
    dragging = false,
    readOnly = false
}: RelationItemRowProps) {
    const intl = useIntl();
    const iconButton = cn(
        buttonVariants({ variant: 'ghost', size: 'icon' }),
        'size-7 shrink-0 text-muted-foreground hover:text-foreground'
    );

    return (
        <div
            ref={rowRef}
            style={style}
            className={cn(
                'flex items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 transition-colors hover:border-border/80',
                dragging ? 'opacity-60 shadow-sm' : ''
            )}
        >
            {readOnly ? null : (dragHandle ?? null)}
            {leading ?? null}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate text-sm font-medium">{title}</span>
                {handle ? (
                    <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
                        /{handle}
                    </span>
                ) : null}
            </div>
            {status ? (
                <Badge
                    variant={
                        status === ENTRY_STATUS.Published
                            ? 'success'
                            : 'secondary'
                    }
                    className="shrink-0"
                >
                    {intl.formatMessage(
                        status === ENTRY_STATUS.Published
                            ? messages.statusPublished
                            : messages.statusDraft
                    )}
                </Badge>
            ) : null}
            {onMoveUp && !readOnly ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={moveUpLabel}
                    disabled={moveUpDisabled}
                    onClick={onMoveUp}
                >
                    <ChevronUp className="size-4" aria-hidden />
                </Button>
            ) : null}
            {onMoveDown && !readOnly ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={moveDownLabel}
                    disabled={moveDownDisabled}
                    onClick={onMoveDown}
                >
                    <ChevronDown className="size-4" aria-hidden />
                </Button>
            ) : null}
            {href ? (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={iconButton}
                    aria-label={openLabel}
                >
                    <ExternalLink className="size-4" aria-hidden />
                </a>
            ) : null}
            {onReplace && !readOnly ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onReplace}
                >
                    {intl.formatMessage(messages.replace)}
                </Button>
            ) : null}
            {readOnly ? null : (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={removeLabel}
                    onClick={onRemove}
                >
                    <X className="size-4" />
                </Button>
            )}
        </div>
    );
}
