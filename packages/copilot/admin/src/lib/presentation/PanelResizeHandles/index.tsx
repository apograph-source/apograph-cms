import { defineMessages, useIntl } from 'react-intl';
import { cn } from '@orthacms/design-system';
import type { ResizeEdge } from '../../application/panelFrame';
import {
    keyboardStep,
    type PanelFrameControls
} from '../../application/usePanelFrame';

const messages = defineMessages({
    resize: {
        id: 'copilot.panel.resize',
        defaultMessage: 'Resize Ortha AI'
    },
    resizeHint: {
        id: 'copilot.panel.resizeHint',
        defaultMessage:
            'Drag to resize. With this focused, arrow keys resize; hold Shift for larger steps.'
    }
});

/**
 * Where each strip sits and which way it stretches. The panel is
 * `position: fixed`, so it is its own containing block and these can be
 * absolutely positioned against it with no extra wrapper.
 *
 * The strips straddle the border (`-inset-*`) rather than sitting inside it:
 * a handle flush with the edge is a handle you have to be pixel-accurate to
 * hit, and the two or three pixels outside the panel are where people
 * instinctively aim.
 */
const EDGES: { edge: ResizeEdge; className: string }[] = [
    { edge: 'n', className: 'top-0 right-2 left-2 -mt-1 h-2 cursor-ns-resize' },
    {
        edge: 's',
        className: 'right-2 bottom-0 left-2 -mb-1 h-2 cursor-ns-resize'
    },
    {
        edge: 'w',
        className: 'top-2 bottom-2 left-0 -ml-1 w-2 cursor-ew-resize'
    },
    {
        edge: 'e',
        className: 'top-2 right-0 bottom-2 -mr-1 w-2 cursor-ew-resize'
    },
    {
        edge: 'ne',
        className: 'top-0 right-0 -mt-1 -mr-1 size-3 cursor-nesw-resize'
    },
    {
        edge: 'se',
        className: 'right-0 bottom-0 -mr-1 -mb-1 size-3 cursor-nwse-resize'
    },
    {
        edge: 'sw',
        className: 'bottom-0 left-0 -mb-1 -ml-1 size-3 cursor-nesw-resize'
    }
];

/** Which arrow key moves which way, as a `[dx, dy]` unit vector. */
const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
};

/**
 * The eight grab strips that make the panel resizable.
 *
 * **Seven are pointer-only and one is not.** Eight focusable splitters would
 * add eight tab stops to a non-modal surface a keyboard user is passing
 * *through* on the way back to the page — which is the whole reason the panel
 * has no focus trap. So the north-west corner is a real `<button>` with arrow
 * keys, and it alone: the panel's home is the bottom-right corner, so growing
 * up and to the left is the direction that has somewhere to go, and one handle
 * that resizes both axes covers what the other seven do between them.
 *
 * The rest carry `aria-hidden`, because a strip that cannot be reached without
 * a pointer and does nothing when it is reached is noise in the accessibility
 * tree, not an affordance.
 */
export function PanelResizeHandles({
    controls
}: {
    controls: PanelFrameControls;
}) {
    const intl = useIntl();

    return (
        <>
            {EDGES.map(({ edge, className }) => (
                <div
                    key={edge}
                    aria-hidden
                    // `touch-none` so a drag on a touch screen resizes the
                    // panel instead of scrolling the page behind it.
                    className={cn('absolute z-10 touch-none', className)}
                    onPointerDown={(event) => controls.startResize(edge, event)}
                    {...controls.handleProps}
                />
            ))}

            <button
                type="button"
                aria-label={intl.formatMessage(messages.resize)}
                title={intl.formatMessage(messages.resizeHint)}
                className={cn(
                    'absolute top-0 left-0 z-10 -mt-1 -ml-1 size-3 touch-none cursor-nwse-resize',
                    'rounded-tl-lg focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none'
                )}
                onPointerDown={(event) => controls.startResize('nw', event)}
                onKeyDown={(event) => {
                    const arrow = ARROWS[event.key];
                    if (!arrow) return;
                    event.preventDefault();
                    const step = keyboardStep(event);
                    // Anchored north-west, so left and up **grow** the panel —
                    // the handle moves the way the key points, and the corner it
                    // is pinned against is the one that stays put.
                    controls.nudgeResize(
                        'nw',
                        arrow[0] * step,
                        arrow[1] * step
                    );
                }}
                {...controls.handleProps}
            />
        </>
    );
}
