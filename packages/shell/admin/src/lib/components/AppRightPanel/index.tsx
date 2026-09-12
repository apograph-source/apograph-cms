import { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { PanelRightClose } from 'lucide-react';
import { Button, cn, useIsMobile } from '@orthacms/design-system';
import {
    RIGHT_PANEL_ID,
    usePageChromeHosts,
    usePanelFocusHandoff,
    useRightPanel
} from '../../utils/pageChrome';

const messages = defineMessages({
    hide: {
        id: 'shell.rightPanel.hide',
        defaultMessage: 'Hide {title}'
    }
});

/**
 * The shell's **right panel** — the column beside the main inset that a page
 * fills through `RightPanelPortal` (the entry editor's Properties). It owns the
 * chrome only: a header aligned to the page's top bar (same `h-12` + bottom
 * border, so the two read as one band) over an independently scrolling body.
 *
 * The body host is **always mounted**, even with no panel registered and while
 * one is collapsed — a portal needs its target to exist, and keeping it mounted
 * means collapsing the panel never unmounts the filler, throwing away its state
 * and refetching its data. When there is nothing to show the column is zero-width
 * and `inert`, so it takes no space and leaves the accessibility tree.
 *
 * Collapsed, the control that brings it back lives in the top bar (`PageActions`)
 * — the panel can't offer it while it has no width to draw in.
 *
 * It **slides**, on the app sidebar's timing and curve (300ms, ease-in-out). The mechanism is the
 * sidebar's too: the column animates its width while the panel inside keeps its
 * own, so the panel slides out of the clip instead of re-wrapping its contents
 * on every frame. (The sidebar spells this as a `fixed` panel moved by `left`
 * beside a width-animated gap; a right-edge column can just narrow, because its
 * right edge is already pinned to the viewport.)
 *
 * The transition is **gated on `panel.animate`**, which only the toggle arms —
 * so the panel does not slide in on first paint, or each time a page registers
 * one. Motion here means "you just did that", nothing else.
 *
 * **On a phone it overlays instead of taking a column**: a 22rem column would
 * leave the content nothing. It slides in from the right edge over a scrim that
 * dismisses it, and it starts collapsed there regardless of the desktop
 * preference (see `readOpen`).
 */
export function AppRightPanel() {
    const intl = useIntl();
    const { setPanelHost } = usePageChromeHosts();
    const panel = useRightPanel();
    const isMobile = useIsMobile();
    const shown = !!panel?.present && panel.open;
    const animate = !!panel?.animate;
    const collapseRef = usePanelFocusHandoff('panel');
    const toggle = panel?.toggle;

    // `Esc` dismisses the mobile overlay. The overlay is not a Radix `Sheet` on
    // purpose — a Sheet unmounts its content when closed, and the panel's body is
    // a **portal host** that has to stay mounted or collapsing would throw away
    // the filler's state and refetch its data (see the class comment). So the one
    // affordance a Sheet would have brought for free is added by hand.
    //
    // Deliberately yields to anything stacked on top: a dialog, menu or listbox
    // open over the panel owns `Esc` first, and closing the panel out from under
    // it would strand the user twice over.
    useEffect(() => {
        if (!isMobile || !shown || !toggle) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            //
            // `:not(#RIGHT_PANEL_ID)` because the panel is **itself** a
            // `role="dialog"` on this breakpoint now (`ORT-154`) — without the
            // exclusion this handler found the panel, concluded something was
            // stacked on top of it, and yielded to itself, so `Esc` stopped
            // working the moment the attribute was added.
            if (
                document.querySelector(
                    `[role="dialog"]:not(#${RIGHT_PANEL_ID}),[role="alertdialog"],[role="menu"],[role="listbox"]`
                )
            ) {
                return;
            }
            toggle();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isMobile, shown, toggle]);

    return (
        <>
            {isMobile && shown ? (
                // A scrim, not a control: it was a `<button aria-hidden
                // tabIndex={-1}>`, which advertises a role to nobody and cannot be
                // operated by keyboard — a dismiss affordance that only a pointer
                // could reach. The keyboard equivalents are `Esc` (above) and the
                // panel's own collapse button, so this is honest as inert
                // decoration.
                <div
                    aria-hidden
                    onClick={toggle}
                    className="fixed inset-0 z-30 cursor-default bg-foreground/20"
                />
            ) : null}
            <aside
                id={RIGHT_PANEL_ID}
                aria-label={shown ? panel?.title : undefined}
                // On a phone this is an overlay covering the page, so it says so
                // — but only *here*, and only now. The attributes are a promise
                // that everything outside is unreachable, and until `AppShell`
                // started inerting the page behind it (`ORT-154`) that promise
                // would have been false; a truthful `complementary` beats a
                // `dialog` the markup does not keep. As a desktop column it
                // covers nothing and stays a complementary landmark.
                role={isMobile && shown ? 'dialog' : undefined}
                aria-modal={isMobile && shown ? true : undefined}
                inert={!shown}
                className={cn(
                    'flex shrink-0 overflow-hidden motion-reduce:transition-none',
                    isMobile
                        ? // Overlay: off the right edge and back, so the
                          // content underneath keeps its full width.
                          cn(
                              'fixed inset-y-0 right-0 z-40 w-[min(22rem,88vw)]',
                              animate &&
                                  'transition-transform duration-300 ease-in-out',
                              shown ? 'translate-x-0' : 'translate-x-full'
                          )
                        : // Column: full height of the viewport-bounded shell
                          // row, so the panel scrolls on its own rather than
                          // riding the inset's scrollport.
                          cn(
                              'h-full',
                              animate &&
                                  'transition-[width] duration-300 ease-in-out',
                              shown ? 'w-[22rem]' : 'w-0'
                          )
                )}
            >
                {/* Never unmounted, and — in the column layout — a **fixed**
                    width: this is what slides. It must not be `max-w-full`
                    there, or it would shrink with the animating column and
                    re-wrap its contents line by line instead of sliding out of
                    the clip. On mobile the column doesn't animate its width (it
                    translates), so the panel simply fills it. */}
                <div
                    className={cn(
                        'flex h-full shrink-0 flex-col border-l bg-background',
                        isMobile ? 'w-full' : 'w-[22rem]'
                    )}
                >
                    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
                        <h2 className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em]">
                            {panel?.title}
                        </h2>
                        <Button
                            ref={collapseRef}
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="-mr-1 size-7 shrink-0 text-muted-foreground"
                            aria-controls={RIGHT_PANEL_ID}
                            aria-expanded
                            aria-label={intl.formatMessage(messages.hide, {
                                title: panel?.title ?? ''
                            })}
                            onClick={toggle}
                        >
                            <PanelRightClose aria-hidden />
                        </Button>
                    </div>
                    <div
                        ref={setPanelHost}
                        // Same gutter the main scrollport reserves: this column
                        // reaches the bottom of the viewport, and the entry
                        // rail's own controls sit at the bottom of it.
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--ortha-fixed-bottom-gutter,0px)]"
                    />
                </div>
            </aside>
        </>
    );
}
