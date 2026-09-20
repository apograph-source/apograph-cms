import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Which of the two collapse/reopen controls should take focus after a
 * {@link RightPanel.toggle}.
 *
 * The pair is deliberately split across two components — the panel's own header
 * holds "Hide {title}", the top bar holds "Show {title}" — and only one of them
 * exists (outside an `inert` subtree) at a time. So a toggle always destroys the
 * control that caused it, and without a handoff the browser blurs to `<body>`:
 * a keyboard user's next Tab restarts from the top of the document, and a screen
 * reader hears nothing at all (WCAG 2.4.3, 4.1.3). This names the survivor so it
 * can claim focus in the same commit that reveals it.
 */
export type PanelFocusTarget = 'panel' | 'bar';

/** The right panel as the chrome sees it: whether there is one, and its state. */
export type RightPanel = {
    /** Whether a page has registered a panel — nothing renders without one. */
    present: boolean;
    /** Whether the panel column is shown (false = collapsed away). */
    open: boolean;
    /** The registered panel's heading. */
    title: string;
    /** Collapse an open panel, or reopen a collapsed one. */
    toggle: () => void;
    /**
     * Whether the panel should **animate** its current change. True only for the
     * window around a {@link toggle}; a panel that appears because a page
     * registered one, or that is simply open on first paint, must not slide in.
     */
    animate: boolean;
};

type PageChromeValue = RightPanel & {
    /** The top bar's actions container, once the bar has mounted one. */
    actionsHost: HTMLElement | null;
    setActionsHost: (node: HTMLElement | null) => void;
    /** The right panel's body container. */
    panelHost: HTMLElement | null;
    setPanelHost: (node: HTMLElement | null) => void;
    /** Registers a panel + its title while a filler is mounted. */
    registerPanel: (title: string) => () => void;
    /**
     * The control that should take focus after the last {@link RightPanel.toggle},
     * or `null` when there is no pending handoff. See {@link PanelFocusTarget}.
     */
    focusTarget: PanelFocusTarget | null;
    /** Drops the pending handoff — called by whichever control claimed it. */
    clearFocusTarget: () => void;
};

const Context = createContext<PageChromeValue | null>(null);

/**
 * DOM id of the right panel, so the top bar's expand button can `aria-controls`
 * it — the control and the region live in different components, and this is the
 * only thing tying them together.
 */
export const RIGHT_PANEL_ID = 'app-right-panel';

/** localStorage key for the right panel's open/collapsed state. */
const STORAGE_KEY = 'ortha:right-panel';

/** How long the panel's slide runs — keep in step with its `duration-300`. */
const PANEL_SLIDE_MS = 330;

/** Below this the panel overlays the content instead of taking a column. */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Reads the persisted state, tolerating missing/blocked/corrupt storage.
 * **Starts collapsed on a small screen** whatever was persisted: there the panel
 * is an overlay, and one covering the page on arrival is not what anyone asked
 * for. The desktop preference is left untouched, so it comes back on a wide
 * screen.
 */
function readOpen(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        if (window.matchMedia(MOBILE_QUERY).matches) return false;
        return window.localStorage.getItem(STORAGE_KEY) !== 'collapsed';
    } catch {
        return true;
    }
}

/**
 * Holds the two **page-chrome regions** the shell owns but doesn't fill: the top
 * bar's trailing actions region, and the right panel beside the main inset.
 *
 * Both are filled by **portal**, not by handing a node up the way
 * `useSidebarContent` does. React resolves context by where a node is *rendered*,
 * so a node the shell renders would be cut off from everything below it — the
 * open workspace (`useCurrentWorkspace`), a plugin's own slot context, a page's
 * form state and handlers. `createPortal` moves only the DOM and keeps the React
 * tree, so a filler stays inside the page that owns it. (`ContentNavSection` in
 * content-admin shows the alternative: it has to re-resolve the workspace itself
 * because it renders above the provider.)
 *
 * The panel's open/collapsed state lives here rather than with the filler,
 * because the control that flips it is chrome — it has to work from the top bar
 * when the panel is collapsed and the filler has nowhere to draw. It is
 * persisted (guarded, so private mode degrades to in-memory) since pages remount
 * constantly and a collapse the user asked for shouldn't spring back.
 */
export function PageChromeProvider({ children }: { children: ReactNode }) {
    const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
    const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
    // Ref-counted, so the overlap while a page remounts can't read as "gone".
    const [panels, setPanels] = useState<string[]>([]);
    const [open, setOpen] = useState<boolean>(readOpen);
    // Armed by `toggle`, disarmed once the slide is over. Gating the transition
    // on this is what keeps the panel from sliding in on first paint, or every
    // time a page registers one — motion should mean "you just did that".
    const [animate, setAnimate] = useState(false);
    // Set by `toggle`, claimed by whichever of the two controls the toggle just
    // revealed. See `PanelFocusTarget`.
    const [focusTarget, setFocusTarget] = useState<PanelFocusTarget | null>(
        null
    );

    useEffect(() => {
        if (!animate) return;
        const timer = setTimeout(() => setAnimate(false), PANEL_SLIDE_MS);
        return () => clearTimeout(timer);
    }, [animate]);

    // A handoff nobody claimed has to expire, or it would be claimed by the
    // *next* control to mount — a page navigated to minutes later stealing focus
    // out of nowhere. React runs child effects before this one, so a control that
    // is on screen has already cleared it by the time this timer is armed.
    useEffect(() => {
        if (!focusTarget) return;
        const timer = setTimeout(() => setFocusTarget(null), 0);
        return () => clearTimeout(timer);
    }, [focusTarget]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            // A narrow viewport forces the panel collapsed whatever was stored
            // (see `readOpen`) — and that is a layout decision, not something the
            // user asked for. Writing it back overwrote the desktop preference,
            // so a single page load on a phone left the panel collapsed on the
            // next wide-screen visit, with nothing to explain why. Persist only
            // where the preference actually applies.
            if (window.matchMedia(MOBILE_QUERY).matches) return;
            window.localStorage.setItem(
                STORAGE_KEY,
                open ? 'open' : 'collapsed'
            );
        } catch {
            // Storage unavailable (private mode, quota) — keep it in memory.
        }
    }, [open]);

    const registerPanel = useCallback((title: string) => {
        setPanels((current) => [...current, title]);
        return () =>
            setPanels((current) => {
                const at = current.indexOf(title);
                if (at === -1) return current;
                const next = current.slice();
                next.splice(at, 1);
                return next;
            });
    }, []);

    const clearFocusTarget = useCallback(() => setFocusTarget(null), []);

    const toggle = useCallback(() => {
        setAnimate(true);
        // Named from `open` rather than inside the updater, because the survivor
        // has to be decided in the same render as the flip: collapsing leaves the
        // top bar's reopen button, reopening leaves the panel's own collapse
        // button.
        setFocusTarget(open ? 'bar' : 'panel');
        setOpen(!open);
    }, [open]);

    const value = useMemo<PageChromeValue>(
        () => ({
            present: panels.length > 0,
            // The newest registration wins, so a page that mounts over another
            // heads the panel with its own title.
            title: panels[panels.length - 1] ?? '',
            open,
            toggle,
            animate,
            actionsHost,
            setActionsHost,
            panelHost,
            setPanelHost,
            registerPanel,
            focusTarget,
            clearFocusTarget
        }),
        [
            panels,
            open,
            toggle,
            animate,
            actionsHost,
            panelHost,
            registerPanel,
            focusTarget,
            clearFocusTarget
        ]
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Reads the chrome context; throws outside a {@link PageChromeProvider}. */
function usePageChrome(): PageChromeValue {
    const ctx = useContext(Context);
    if (!ctx) {
        throw new Error(
            'Page chrome components must be used within a PageChromeProvider.'
        );
    }
    return ctx;
}

/**
 * The right panel's state, for the chrome that draws it (the panel column and
 * the top bar's expand button). Returns `null` outside a provider, so a bar
 * rendered in isolation (a test, a story) simply shows no panel controls.
 */
export function useRightPanel(): RightPanel | null {
    const ctx = useContext(Context);
    if (!ctx) return null;
    const { present, open, title, toggle, animate } = ctx;
    return { present, open, title, toggle, animate };
}

/**
 * Renders its children into the **top bar's trailing actions region** — the page
 * actions a bar can't know about (the entry editor's Publish + ⋯). Renders
 * nothing until a bar with a `PageActions` region is on screen, so a page that
 * mounts before its bar simply appears a frame later.
 *
 * Mount it from inside the page that owns the actions: the children keep that
 * page's context, so handlers, permissions and busy state all still resolve.
 */
export function PageActionsPortal({ children }: { children: ReactNode }) {
    const { actionsHost } = usePageChrome();
    return actionsHost ? createPortal(children, actionsHost) : null;
}

/**
 * Renders its children into the shell's **right panel**, and registers the panel
 * (with its heading) for as long as this is mounted — that registration is what
 * makes the column and its toggle exist at all.
 *
 * The children stay mounted while the panel is collapsed (the host is hidden,
 * not unmounted), so collapsing never throws away their state or refetches their
 * data.
 */
export function RightPanelPortal({
    title,
    children
}: {
    /** The panel's heading, shown in its header row. */
    title: string;
    children: ReactNode;
}) {
    const { panelHost, registerPanel } = usePageChrome();

    useEffect(() => registerPanel(title), [registerPanel, title]);

    return panelHost ? createPortal(children, panelHost) : null;
}

/** Internal: the hosts, for the shell chrome that mounts them. */
export function usePageChromeHosts() {
    const { setActionsHost, setPanelHost, present, open } = usePageChrome();
    return { setActionsHost, setPanelHost, present, open };
}

/**
 * Internal: gives one of the two panel toggles a ref that takes focus whenever a
 * {@link RightPanel.toggle} named it the survivor.
 *
 * Focus has to move *to* the replacement, not merely away from the vanished
 * control: `AppRightPanel` sets `inert` on the `<aside>` that contains its own
 * collapse button, and `PageActions` unmounts its reopen button the moment the
 * panel is back — so in both directions the element the user just activated stops
 * being focusable and the browser drops to `<body>`. Each control claims its own
 * handoff rather than the provider reaching into the DOM for it, so the focus
 * move happens in the same commit that makes the control focusable.
 *
 * Returns `null` outside a {@link PageChromeProvider} — the same tolerance
 * {@link useRightPanel} has, so a bar rendered in isolation still works.
 */
export function usePanelFocusHandoff(
    target: PanelFocusTarget
): (node: HTMLButtonElement | null) => void {
    const ctx = useContext(Context);
    const focusTarget = ctx?.focusTarget ?? null;
    const clearFocusTarget = ctx?.clearFocusTarget;
    const nodeRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (focusTarget !== target) return;
        // `inert` is already gone (and the button already mounted) by the time
        // effects run for this commit, so a plain `focus()` lands.
        nodeRef.current?.focus();
        clearFocusTarget?.();
    }, [focusTarget, target, clearFocusTarget]);

    return useCallback((node: HTMLButtonElement | null) => {
        nodeRef.current = node;
    }, []);
}
