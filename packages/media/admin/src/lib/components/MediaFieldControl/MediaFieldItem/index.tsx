import { useId } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    ArrowDown,
    ArrowUp,
    ExternalLink,
    FileWarning,
    Trash2
} from 'lucide-react';
import {
    Button,
    Checkbox,
    Field,
    FieldLabel,
    Input,
    cn
} from '@orthacms/design-system';
import { MEDIA_ALT_MAX_LENGTH } from '@orthacms/content-domain';
import { MEDIA_KIND, type MediaKind } from '../../../constants';
import type { MediaFieldDisplay } from '../../../types/mediaFieldDisplay';
import { assetGradient } from '../../../utils/assetGradient';
import { formatBytes } from '../../../utils/formatBytes';
import { MediaKindIcon } from '../../MediaKindIcon';

/** Intl descriptors for {@link MediaFieldItem}, co-located. */
const messages = defineMessages({
    altLabel: {
        id: 'media.field.item.altLabel',
        defaultMessage: 'Alt text for {name}'
    },
    altPlaceholder: {
        id: 'media.field.item.altPlaceholder',
        defaultMessage: 'Describe this image'
    },
    altMissing: {
        id: 'media.field.item.altMissing',
        defaultMessage: 'Needs alt text'
    },
    decorativeLabel: {
        id: 'media.field.item.decorativeLabel',
        defaultMessage: 'Decorative — no description needed'
    },
    remove: { id: 'media.fieldItem.remove', defaultMessage: 'Remove {name}' },
    preview: {
        id: 'media.fieldItem.preview',
        defaultMessage: 'Open {name} in a new tab'
    },
    moveUp: { id: 'media.fieldItem.moveUp', defaultMessage: 'Move {name} up' },
    moveDown: {
        id: 'media.fieldItem.moveDown',
        defaultMessage: 'Move {name} down'
    },
    unavailable: {
        id: 'media.fieldItem.unavailable',
        defaultMessage: 'Unavailable asset'
    },
    unavailableHint: {
        id: 'media.fieldItem.unavailableHint',
        defaultMessage: 'Deleted or out of workspace'
    },
    pending: {
        id: 'media.fieldItem.pending',
        defaultMessage: 'Uploads on save'
    },
    resolving: {
        id: 'media.fieldItem.resolving',
        defaultMessage: 'Loading asset…'
    },
    position: {
        id: 'media.fieldItem.position',
        defaultMessage: 'Position {index} of {total}'
    }
});

/** `image/png` → `PNG`; the short type label under the file name. */
function formatKind(mimeType: string): string | null {
    const subtype = mimeType.split('/')[1];
    if (!subtype) return null;
    return subtype.split('+')[0]?.toUpperCase() ?? null;
}

/** The glyph kind for a ref's `kind` string, falling back for an unknown one. */
function kindOf(kind: string): MediaKind {
    const known = Object.values(MEDIA_KIND) as string[];
    return known.includes(kind) ? (kind as MediaKind) : MEDIA_KIND.Document;
}

/**
 * One attached asset on a media field — a preview tile (the real image, else the
 * asset's deterministic gradient behind its kind glyph) over the file name and
 * what is known of its type / size / dimensions, with the per-item controls
 * revealed on hover or focus: open in a new tab, remove, and — in an ordered
 * multiple field — nudge up/down. A `missing` ref renders as an explicit warning
 * tile instead of a broken preview, so a dead id can still be found and removed,
 * and a `resolving` one (its ref still in flight) renders a placeholder rather
 * than guessing a URL — a guess would fetch the full-size original.
 *
 * In a **read-only** editor the tile keeps its preview, its name, its metadata
 * and its open-in-a-new-tab link, and drops remove + reorder. The position badge
 * stays: order is part of what the field *holds*, not a control.
 */
export function MediaFieldItem({
    item,
    index,
    total,
    multiple,
    readOnly = false,
    onRemove,
    onMove,
    alt,
    decorative = false,
    onAltChange,
    onDecorativeChange
}: {
    item: MediaFieldDisplay;
    /** Zero-based position, shown (1-based) and used to gate the arrows. */
    index: number;
    total: number;
    /** Ordered-multiple field: renders the position badge + reorder arrows. */
    multiple: boolean;
    /** Preview mode — drop the remove and reorder controls. */
    readOnly?: boolean;
    onRemove: () => void;
    onMove: (delta: number) => void;
    /** The text alternative stored on **this usage**, if any. */
    alt?: string;
    /** Whether this usage is marked purely presentational. */
    decorative?: boolean;
    onAltChange?: (next: string) => void;
    onDecorativeChange?: (next: boolean) => void;
}) {
    const intl = useIntl();
    const altId = useId();
    const asImage = item.kind === MEDIA_KIND.Image;
    const meta = [
        formatKind(item.mimeType),
        typeof item.size === 'number' ? formatBytes(item.size) : null,
        item.dimensions
            ? `${item.dimensions.width}×${item.dimensions.height}`
            : null
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <li
            className={cn(
                'group/item relative overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md',
                item.missing && 'border-destructive/50',
                (item.pending || item.resolving) && 'border-dashed'
            )}
        >
            <div
                className="relative aspect-[4/3] w-full overflow-hidden bg-muted"
                style={
                    !item.missing && !item.resolving && !asImage
                        ? { backgroundImage: assetGradient(item.id) }
                        : undefined
                }
            >
                {item.resolving ? (
                    <span
                        className="flex size-full animate-pulse items-center justify-center bg-muted text-[11px] text-muted-foreground"
                        // The name is unknown too, so the tile announces what it
                        // is doing rather than showing a bare grey box.
                    >
                        {intl.formatMessage(messages.resolving)}
                    </span>
                ) : item.missing ? (
                    <span className="flex size-full flex-col items-center justify-center gap-1 bg-destructive/5 px-2 text-center text-destructive">
                        <FileWarning className="size-6" aria-hidden />
                        <span className="text-[11px] font-medium leading-tight">
                            {intl.formatMessage(messages.unavailableHint)}
                        </span>
                    </span>
                ) : asImage ? (
                    <img
                        src={item.url}
                        alt={item.name}
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                    />
                ) : (
                    <span className="flex size-full items-center justify-center">
                        <MediaKindIcon
                            kind={kindOf(item.kind)}
                            className="size-8 text-white/90 drop-shadow-sm"
                        />
                    </span>
                )}

                {multiple ? (
                    <span
                        className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded bg-black/60 text-[11px] font-medium tabular-nums text-white"
                        title={intl.formatMessage(messages.position, {
                            index: index + 1,
                            total
                        })}
                    >
                        {index + 1}
                    </span>
                ) : null}

                {item.pending ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning-soft-foreground shadow-sm">
                        {intl.formatMessage(messages.pending)}
                    </span>
                ) : null}

                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 shadow-sm backdrop-blur transition-opacity focus-within:opacity-100 group-hover/item:opacity-100 sm:opacity-0">
                    {item.missing || item.pending || item.resolving ? null : (
                        <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="size-6"
                        >
                            <a
                                href={item.originalUrl ?? item.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={intl.formatMessage(
                                    messages.preview,
                                    { name: item.name }
                                )}
                            >
                                <ExternalLink
                                    className="size-3.5"
                                    aria-hidden
                                />
                            </a>
                        </Button>
                    )}
                    {readOnly ? null : (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={intl.formatMessage(messages.remove, {
                                name: item.name
                            })}
                            onClick={onRemove}
                        >
                            <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                    )}
                </div>

                {multiple && total > 1 && !readOnly ? (
                    <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 shadow-sm backdrop-blur transition-opacity focus-within:opacity-100 group-hover/item:opacity-100 sm:opacity-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            disabled={index === 0}
                            aria-label={intl.formatMessage(messages.moveUp, {
                                name: item.name
                            })}
                            onClick={() => onMove(-1)}
                        >
                            <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            disabled={index === total - 1}
                            aria-label={intl.formatMessage(messages.moveDown, {
                                name: item.name
                            })}
                            onClick={() => onMove(1)}
                        >
                            <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="min-w-0 px-2.5 py-2">
                <p
                    className={cn(
                        'truncate text-xs font-medium',
                        item.missing && 'text-destructive',
                        item.resolving && 'text-muted-foreground'
                    )}
                    title={
                        item.missing || item.resolving ? undefined : item.name
                    }
                >
                    {item.missing
                        ? intl.formatMessage(messages.unavailable)
                        : item.resolving
                          ? intl.formatMessage(messages.resolving)
                          : item.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                    {item.missing ? item.id : item.resolving ? '' : meta}
                </p>
            </div>

            {/* The text alternative, **per usage**. Attaching an asset used to
                prompt for nothing at all: the stored value was a bare id with
                nowhere to put one, so an author could publish an image nobody
                could read and the tool called the entry valid (WCAG 1.1.1, 508
                504.3 — `ORT-83`, `ORT-91`). The same image legitimately needs
                different alt in different places, which is why this lives on the
                field rather than only on the library row.

                Hidden for a missing or still-resolving asset: there is nothing
                to describe yet, and for a non-image the question is usually the
                wrong one — a PDF attachment is named by its link text. */}
            {!readOnly && !item.missing && !item.resolving && onAltChange ? (
                <div className="flex flex-col gap-1.5 border-t px-2.5 py-2">
                    <Field>
                        <FieldLabel htmlFor={altId} className="text-[11px]">
                            {intl.formatMessage(messages.altLabel, {
                                name: item.name
                            })}
                        </FieldLabel>
                        <Input
                            id={altId}
                            value={alt ?? ''}
                            disabled={decorative}
                            maxLength={MEDIA_ALT_MAX_LENGTH}
                            placeholder={intl.formatMessage(
                                messages.altPlaceholder
                            )}
                            onChange={(event) =>
                                onAltChange(event.target.value)
                            }
                            className="h-7 text-xs"
                        />
                    </Field>
                    {onDecorativeChange ? (
                        <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                            <Checkbox
                                checked={decorative}
                                onCheckedChange={(next) =>
                                    onDecorativeChange(next === true)
                                }
                            />
                            {intl.formatMessage(messages.decorativeLabel)}
                        </label>
                    ) : null}
                    {/* Not an error — the entry is only *unpublishable*, and
                        only when the field is required. A warning that names the
                        gap beats a red banner on a draft somebody is still
                        writing. */}
                    {!decorative && !(alt ?? '').trim() ? (
                        <p className="text-warning-soft-foreground text-[11px]">
                            {intl.formatMessage(messages.altMissing)}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </li>
    );
}
