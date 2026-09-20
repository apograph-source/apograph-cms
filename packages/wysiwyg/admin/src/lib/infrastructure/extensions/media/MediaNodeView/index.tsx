import { useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { cn } from '@orthacms/design-system';
import {
    MEDIA_MIN_WIDTH,
    MEDIA_RESIZE_STEP,
    WYSIWYG_MEDIA_KIND,
    asMediaAlign
} from '../../../../domain/constants';
import { mediaAltAttributes } from '../../../../domain/mediaAlt';
import { AltTextPopover } from './AltTextPopover';

const messages = defineMessages({
    resize: {
        id: 'wysiwyg.media.resize',
        defaultMessage: 'Resize — drag, or use the arrow keys'
    },
    imageAlt: {
        id: 'wysiwyg.media.imageAlt',
        defaultMessage: 'Embedded image'
    }
});

/** Shift multiplies an arrow-key step, for crossing a wide image quickly. */
const COARSE_MULTIPLIER = 4;

/**
 * How a media node renders **inside the editor**: the media itself, plus the
 * resize handle.
 *
 * It lives beside its node rather than under `presentation/` on purpose. A
 * ProseMirror node view is the extension's own rendering plumbing, and putting
 * it in the presentation layer would have `infrastructure/` importing upward —
 * the one direction the layering doesn't allow.
 *
 * The published HTML has none of this: `renderHTML` emits a bare `<img>` /
 * `<video controls>`, and the handle exists only while the document is
 * editable.
 *
 * ### Resizing is keyboard-operable, not just draggable
 *
 * The handle is a real `<button>`, so it is a tab stop with a name, and the
 * arrow keys move it (Shift for a coarse step). A pointer-only resize would be
 * unreachable for anyone not using a mouse — and this is a content decision,
 * not a cosmetic one: the width is stored and published.
 */
export function MediaNodeView({
    node,
    selected,
    editor,
    updateAttributes
}: ReactNodeViewProps) {
    const intl = useIntl();
    const figureRef = useRef<HTMLElement>(null);
    /** Width at pointer-down, so a drag is measured from where it started. */
    const dragStart = useRef<{ x: number; width: number } | null>(null);

    const isVideo = node.type.name === WYSIWYG_MEDIA_KIND.Video;
    const src = String(node.attrs['src'] ?? '');
    const alt = String(node.attrs['alt'] ?? '');
    const decorative = node.attrs['decorative'] === true;
    const width =
        typeof node.attrs['width'] === 'number'
            ? (node.attrs['width'] as number)
            : null;
    const align = asMediaAlign(node.attrs['align']);

    /** The rendered width, for a resize that starts from "natural". */
    const measuredWidth = () =>
        width ??
        Math.round(figureRef.current?.getBoundingClientRect().width ?? 0);

    const applyWidth = (next: number) =>
        updateAttributes({
            width: Math.max(MEDIA_MIN_WIDTH, Math.round(next))
        });

    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        // Left button only, and never let the drag reach ProseMirror — it would
        // start a node drag instead of a resize.
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragStart.current = { x: event.clientX, width: measuredWidth() };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = dragStart.current;
        if (!start) return;
        applyWidth(start.width + (event.clientX - start.x));
    };

    const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!dragStart.current) return;
        dragStart.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const step =
            MEDIA_RESIZE_STEP * (event.shiftKey ? COARSE_MULTIPLIER : 1);
        if (event.key === 'ArrowRight') applyWidth(measuredWidth() + step);
        else if (event.key === 'ArrowLeft') applyWidth(measuredWidth() - step);
        // Back to the media's own size — the way out of a resize gone wrong.
        else if (event.key === 'Backspace' || event.key === 'Delete')
            updateAttributes({ width: null });
        else return;
        event.preventDefault();
    };

    return (
        <NodeViewWrapper
            className="ortha-wysiwyg-media"
            data-selected={selected || undefined}
        >
            <figure
                ref={figureRef}
                // The same hook the stored HTML carries, so the editor moves the
                // block by exactly the rule that will move it once published.
                data-align={align}
                // Whether the author has chosen a width. Only a sized figure
                // stretches its media to fill it; an unsized one shrinks to the
                // media's natural size, which is what a bare `<img>` does
                // everywhere else this HTML lands.
                data-sized={width === null ? undefined : ''}
                style={width ? { width: `${width}px` } : undefined}
                className={cn(
                    'relative my-4 max-w-full',
                    selected && 'outline-2 outline-offset-2 outline-ring'
                )}
            >
                {/* No width class here: the stylesheet decides, so a resized
                    block fills the figure and an unsized one keeps its natural
                    size — the same two rules the published HTML gets. */}
                {isVideo ? (
                    <video src={src} controls className="block" />
                ) : (
                    <img
                        src={src}
                        // In the editor an un-alt'd image still needs *a* name,
                        // or it reads as an unlabelled graphic to the author's
                        // own screen reader while they are working. The stored
                        // HTML gets the real value — empty if that's what it is
                        // — because inventing alt for published content would
                        // be worse than none.
                        alt={alt || intl.formatMessage(messages.imageAlt)}
                        className="block"
                    />
                )}

                {/* Alt is a published, per-image decision, so its control lives
                    on the image — the point where the author can see what the
                    picture is doing in the text. Images only: `alt` is not a
                    thing a `<video>` has. */}
                {editor.isEditable && !isVideo ? (
                    <div className="absolute top-1.5 left-1.5">
                        <AltTextPopover
                            alt={alt}
                            decorative={decorative}
                            // Through the shared rule, not straight onto the
                            // node: the popover hands back the description it
                            // kept on screen, and an image marked decorative
                            // must not keep it.
                            onSave={(next) =>
                                updateAttributes(mediaAltAttributes(next))
                            }
                        />
                    </div>
                ) : null}

                {editor.isEditable ? (
                    <button
                        type="button"
                        aria-label={intl.formatMessage(messages.resize)}
                        className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border border-background bg-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={onKeyDown}
                    />
                ) : null}
            </figure>
        </NodeViewWrapper>
    );
}
