import { useCallback, useEffect, useRef, useState } from 'react';
import {
    clampFrame,
    isPanelFrame,
    moveFrame,
    resizeFrame,
    type PanelFrame,
    type ResizeEdge
} from './panelFrame';

/**
 * Where a user-placed frame is remembered, per window **slot**.
 *
 * Keyed by slot rather than by chat, because a chat is ephemeral — its id dies
 * with the window — while "the leftmost chat window" is a place on the screen
 * the user arranged and expects to stay arranged. Slot 0 is the one most people
 * will ever move.
 */
export function panelFrameStorageKey(slot: number): string {
    return `ortha.copilot.panel-frame.${slot}`;
}

/** How far one arrow key moves or resizes the panel, in pixels. */
const STEP = 16;

/** How far `Shift` + arrow moves or resizes it. */
const BIG_STEP = 64;

/** What the panel needs to be movable and resizable. */
export interface PanelFrameControls {
    /** Attach to the panel's root element — the drag seeds from its rect. */
    ref: React.RefObject<HTMLDivElement | null>;
    /**
     * The frame the user placed, or `null` while the panel is still wherever
     * its classes put it. Callers use it to decide whether to apply the docked
     * / expanded size classes at all.
     */
    frame: PanelFrame | null;
    /** Inline position and size, or `undefined` when there is no frame. */
    style: React.CSSProperties | undefined;
    /** True while a pointer drag or resize is in flight. */
    interacting: boolean;
    /** Begins a move. Call from the header's `onPointerDown`. */
    startMove(event: React.PointerEvent): void;
    /** Begins a resize of one edge or corner. */
    startResize(edge: ResizeEdge, event: React.PointerEvent): void;
    /**
     * Spread onto every element that can start a gesture. The moves and the
     * release are delivered to the element that captured the pointer, so each
     * handle listens for them rather than the document doing it once.
     */
    handleProps: {
        onPointerMove(event: React.PointerEvent): void;
        onPointerUp(event: React.PointerEvent): void;
        onPointerCancel(event: React.PointerEvent): void;
    };
    /** Moves by a keyboard step. */
    nudgeMove(dx: number, dy: number): void;
    /** Resizes by a keyboard step, anchored at the opposite edge. */
    nudgeResize(edge: ResizeEdge, dx: number, dy: number): void;
    /** Forgets the placement, returning the panel to its docked home. */
    reset(): void;
}

/**
 * Makes the chat panel a window the user can move and resize.
 *
 * **A frame is opt-in and starts as `null`.** The panel's home is expressed in
 * CSS (`fixed right-4 bottom-4`, plus a size per mode), which is what lets it
 * open correctly on a viewport it has never been opened in and what keeps the
 * docked / expanded / minimized modes meaningful. Only once someone actually
 * drags does this hook take over positioning, and `reset()` hands it back — so
 * the Expand and Shrink buttons double as a way out of a bad drag.
 *
 * **The frame is measured, never assumed.** The first drag reads the panel's
 * real `getBoundingClientRect()`, so the window does not jump when the drag
 * begins: whatever the classes had produced becomes the frame's starting value.
 *
 * **Pointer capture, not window listeners.** `setPointerCapture` keeps the
 * moves coming to the handle even when the pointer outruns it — which it will,
 * because a drag that has to stay inside a 6px edge strip is a drag that stops
 * the moment you flick the mouse. It also means the release always arrives,
 * where a `mouseup` listener on `window` can be swallowed by an iframe or a
 * drag that ends outside the document.
 */
export function usePanelFrame(storageKey: string): PanelFrameControls {
    const ref = useRef<HTMLDivElement>(null);
    const [frame, setFrame] = useState<PanelFrame | null>(() =>
        readStoredFrame(storageKey)
    );
    // Read through a ref so the persist helpers never capture a stale key: a
    // window changes slot when a neighbour closes, and writing the new geometry
    // under the old slot's key would swap two windows' remembered positions.
    const keyRef = useRef(storageKey);
    keyRef.current = storageKey;
    const [interacting, setInteracting] = useState(false);

    // The gesture in flight. A ref rather than state: it changes on every
    // pointermove and nothing renders from it, so putting it in state would
    // re-render the whole transcript at pointer frequency.
    const gesture = useRef<{
        origin: PanelFrame;
        startX: number;
        startY: number;
        edge: ResizeEdge | null;
    } | null>(null);

    const persist = useCallback((next: PanelFrame | null) => {
        setFrame(next);
        writeStoredFrame(keyRef.current, next);
    }, []);

    // A frame saved on a large monitor must not strand the panel off-screen on
    // a small one — and the same applies to merely resizing the window, which
    // is the ordinary case (a browser going full-screen and back).
    useEffect(() => {
        const onResize = () =>
            setFrame((current) =>
                current ? clampFrame(current, viewport()) : null
            );
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    /** The current frame, measured from the DOM if the user hasn't placed one. */
    const currentFrame = useCallback((): PanelFrame | null => {
        if (frame) return frame;
        const rect = ref.current?.getBoundingClientRect();
        return rect
            ? clampFrame(
                  {
                      x: rect.left,
                      y: rect.top,
                      width: rect.width,
                      height: rect.height
                  },
                  viewport()
              )
            : null;
    }, [frame]);

    const begin = useCallback(
        (event: React.PointerEvent, edge: ResizeEdge | null) => {
            // Primary button only: a right-click on the header should open the
            // context menu, not start dragging the window away under it.
            if (event.button !== 0) return;
            const origin = currentFrame();
            if (!origin) return;

            gesture.current = {
                origin,
                startX: event.clientX,
                startY: event.clientY,
                edge
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            // Deliberately **not** `preventDefault()`: that would also cancel
            // the focus a mousedown gives the handle, which is the one thing
            // keyboard resizing needs. Text selection during the drag is
            // suppressed with `select-none` on the panel instead, which stops
            // the same behaviour without touching focus.
            setInteracting(true);
            setFrame(origin);
        },
        [currentFrame]
    );

    const onPointerMove = useCallback((event: React.PointerEvent) => {
        const active = gesture.current;
        if (!active) return;
        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        // Always computed from the gesture's **origin**, never from the last
        // frame: accumulating per-move deltas drifts once a clamp bites, so the
        // panel stops tracking the cursor after it has been pushed against an
        // edge and pulled back.
        setFrame(
            active.edge
                ? resizeFrame(active.origin, active.edge, dx, dy, viewport())
                : moveFrame(active.origin, dx, dy, viewport())
        );
    }, []);

    const onPointerUp = useCallback(() => {
        if (!gesture.current) return;
        gesture.current = null;
        setInteracting(false);
        // Written once at the end rather than on every move: this is the value
        // worth remembering, and a `localStorage` write per pointer frame is a
        // synchronous disk hit inside the drag loop.
        setFrame((current) => {
            writeStoredFrame(keyRef.current, current);
            return current;
        });
    }, []);

    const startMove = useCallback(
        (event: React.PointerEvent) => begin(event, null),
        [begin]
    );

    const startResize = useCallback(
        (edge: ResizeEdge, event: React.PointerEvent) => begin(event, edge),
        [begin]
    );

    const nudgeMove = useCallback(
        (dx: number, dy: number) => {
            const origin = currentFrame();
            if (origin) persist(moveFrame(origin, dx, dy, viewport()));
        },
        [currentFrame, persist]
    );

    const nudgeResize = useCallback(
        (edge: ResizeEdge, dx: number, dy: number) => {
            const origin = currentFrame();
            if (origin) persist(resizeFrame(origin, edge, dx, dy, viewport()));
        },
        [currentFrame, persist]
    );

    const reset = useCallback(() => persist(null), [persist]);

    return {
        ref,
        frame,
        style: frame
            ? {
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height,
                  // The corner the enter/exit transition scales from follows the
                  // panel: a window placed top-left that grows out of its
                  // bottom-right corner reads as the wrong window opening.
                  transformOrigin: 'center'
              }
            : undefined,
        interacting,
        startMove,
        startResize,
        // Bound on the handles themselves rather than on `document`, so the
        // panel never installs a global listener it might fail to remove.
        handleProps: {
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp
        },
        nudgeMove,
        nudgeResize,
        reset
    };
}

/** The keyboard step for an arrow key, doubled by `Shift`. */
export function keyboardStep(event: React.KeyboardEvent): number {
    return event.shiftKey ? BIG_STEP : STEP;
}

function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
}

function readStoredFrame(storageKey: string): PanelFrame | null {
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isPanelFrame(parsed) ? clampFrame(parsed, viewport()) : null;
    } catch {
        // Private-mode storage throws on read in some browsers, and a corrupt
        // entry throws on parse. Neither is worth a broken panel.
        return null;
    }
}

function writeStoredFrame(storageKey: string, frame: PanelFrame | null) {
    try {
        if (frame) {
            window.localStorage.setItem(storageKey, JSON.stringify(frame));
        } else {
            window.localStorage.removeItem(storageKey);
        }
    } catch {
        // Storage full or blocked: the placement is lost on reload, which is a
        // far smaller problem than the panel throwing while being dragged.
    }
}
