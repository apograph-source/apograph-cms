import { Outlet } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    SidebarInset,
    SidebarProvider,
    useIsMobile
} from '@orthacms/design-system';
import { PageChromeProvider, useRightPanel } from '../../utils/pageChrome';
import { SidebarContentProvider } from '../../utils/sidebarContent';
import { AppRightPanel } from '../AppRightPanel';
import { AppSidebar } from '../AppSidebar';
import { SidebarToggle } from './SidebarToggle';

const messages = defineMessages({
    scrollport: {
        id: 'shell.appShell.scrollport',
        defaultMessage: 'Page content'
    },
    skipToContent: {
        id: 'shell.appShell.skipToContent',
        defaultMessage: 'Skip to main content'
    }
});

/** The id of the `<main>` landmark that the skip link targets. */
const MAIN_CONTENT_ID = 'main-content';

/**
 * The authenticated app shell: a collapsible left {@link AppSidebar} beside a
 * `<main>` inset where the matched private route renders. The host mounts this
 * as the single guarded layout for every non-public route, so it appears only
 * for signed-in users.
 *
 * The sidebar is offcanvas — collapsing slides it away entirely so the content
 * takes the full width; a floating {@link SidebarToggle} (fixed top-left, no
 * layout space) reveals it. `SidebarProvider` owns the open/collapsed state
 * (cookie-persisted, ⌘B toggles); `SidebarContentProvider` lets a descendant
 * route take over the sidebar's contextual region (the workspace shell injects
 * its per-workspace nav there).
 *
 * `PageChromeProvider` owns the other two page-fillable regions: the top bar's
 * trailing **actions** and the **right panel** ({@link AppRightPanel}) — both
 * filled by portal from the page that owns them, so their content keeps that
 * page's context.
 *
 * A "Skip to main content" link is the first focusable element (WCAG 2.4.1
 * Bypass Blocks) — visually hidden until focused, it jumps keyboard users past
 * the sidebar to the `<main id="main-content">` landmark.
 */
export function AppShell() {
    return (
        <SidebarContentProvider>
            <PageChromeProvider>
                <AppShellChrome />
            </PageChromeProvider>
        </SidebarContentProvider>
    );
}

/**
 * The shell's chrome, split out so it can *read* the page-chrome context
 * {@link AppShell} provides — a component cannot consume a provider it renders
 * itself.
 *
 * What it needs from it is the narrow-viewport right panel's state. Under `md`
 * that panel is not a column but a fixed overlay over the whole page, and it had
 * no focus containment: tabbing from inside it walked out through the covered
 * page — still fully interactive, merely hidden — and wrapped around to the skip
 * link. A screen-reader user reading linearly got the page behind the overlay
 * with no indication that anything was on top of it (`ORT-154`).
 *
 * It is contained by making everything underneath `inert` while it is up, not by
 * converting the panel to a `Sheet`: a Sheet unmounts its content when closed,
 * and the panel's body is a **portal host** that has to stay mounted or
 * collapsing it would throw away the filler's state and refetch its data — which
 * this package's `AGENTS.md` states as an invariant. `inert` is the one remedy
 * that leaves that invariant alone.
 *
 * The sidebar is not in the list because on a phone it is a Radix `Sheet`:
 * either closed and unmounted, or open with a focus trap of its own.
 */
function AppShellChrome() {
    const intl = useIntl();
    const panel = useRightPanel();
    const isMobile = useIsMobile();

    // The overlay is up only when the panel has something in it *and* is open
    // *and* we are under the mobile breakpoint — as a desktop column it covers
    // nothing, so inerting the page beside it would be a bug, not containment.
    const overlayUp = isMobile && !!panel?.present && panel.open;

    return (
        <SidebarProvider>
            <a
                href={`#${MAIN_CONTENT_ID}`}
                // Out of the tab order while the overlay is up: it is the first
                // focusable element in the document, so it is exactly where a
                // wrapping Tab used to land.
                tabIndex={overlayUp ? -1 : undefined}
                aria-hidden={overlayUp || undefined}
                className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring"
            >
                {intl.formatMessage(messages.skipToContent)}
            </a>
            <AppSidebar />
            {/* `scrollLabel` names the scrollport tab stop — it is focusable so
                a keyboard user can scroll a page that has nothing else to focus,
                and it was an unnamed, roleless stop until now (`ORT-150`). The
                string lives here because the design system carries no
                `react-intl`. */}
            <SidebarInset
                id={MAIN_CONTENT_ID}
                tabIndex={-1}
                scrollLabel={intl.formatMessage(messages.scrollport)}
                inert={overlayUp}
            >
                <Outlet />
            </SidebarInset>
            {/* The third column: empty (zero-width) until a page registers a
                panel — see `AppRightPanel`. */}
            <AppRightPanel />
            {/* Inert with the rest of the page behind the overlay: it is
                `fixed`, so it would otherwise sit above the scrim and stay both
                visible and tabbable.

                On the button itself, **not** a wrapper. It hides itself with
                `[main:has([data-slot=top-bar])~&]:hidden` — a sibling
                combinator against `<main>` — so putting a `<div>` between them
                breaks the selector and the floating toggle reappears on every
                page that has a top bar. */}
            <SidebarToggle inert={overlayUp || undefined} />
        </SidebarProvider>
    );
}
