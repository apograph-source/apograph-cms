import { defineMessages, useIntl } from 'react-intl';
import { Sidebar, SidebarFooter } from '@orthacms/design-system';
import { byOrder } from '@orthacms/utils-admin';
import { SIDEBAR_FOOTER_SLOT } from '../../slots/sidebarSlots';
import { useSidebarContentOverride } from '../../utils/sidebarContent';
import { GlobalSidebar } from './GlobalSidebar';

/** Intl descriptors for {@link AppSidebar}, co-located with the component. */
const messages = defineMessages({
    mobileTitle: {
        id: 'shell.sidebar.mobileTitle',
        defaultMessage: 'Navigation'
    },
    mobileDescription: {
        id: 'shell.sidebar.mobileDescription',
        defaultMessage: 'The main navigation for Ortha CMS.'
    },
    label: {
        id: 'shell.sidebar.label',
        defaultMessage: 'Sidebar'
    }
});

/**
 * The single left sidebar that is the admin's app chrome (replacing the old top
 * toolbar). It has three regions:
 *
 * - a **contextual** region (header + nav) that swaps by route: the global nav
 *   by default, or whatever a descendant injects via `useSidebarContent` (the
 *   workspace shell injects its per-workspace nav there); and
 * - a **persistent** footer from {@link SIDEBAR_FOOTER_SLOT} (the account menu),
 *   shown in both the global and per-workspace contexts.
 *
 * Rendered once by {@link AppShell}. The sidebar itself is slot-agnostic beyond
 * the footer: the global region is owned by {@link GlobalSidebar}; the override
 * comes from feature plugins, so new destinations appear without touching this.
 *
 * `collapsible="offcanvas"` — collapsing slides the whole panel off-screen (the
 * content nav, collections/pages included, doesn't reduce cleanly to icons), and
 * a reveal button ({@link SidebarToggle}) brings it back. On mobile it renders as
 * an overlay drawer.
 *
 * shadcn's `SidebarRail` is deliberately **not** rendered. It is a 16px-wide
 * invisible strip hanging off the panel's edge that toggles on click — with
 * `offcanvas` it is shifted outside the panel and paints a hairline plus a full
 * `bg-sidebar` block on hover, so it reads as a stray bar in the page with
 * nothing explaining it. It is also `tabIndex={-1}`, so it's a mouse-only
 * affordance for something already covered three ways: the in-header trigger,
 * the `TopBar`'s inline reveal trigger, and ⌘B.
 */
export function AppSidebar() {
    const intl = useIntl();
    const override = useSidebarContentOverride();
    const footerItems = byOrder(SIDEBAR_FOOTER_SLOT.getItems());

    return (
        // On mobile the sidebar *is* a dialog, and it announced itself as the
        // design system's English default ("Sidebar") in every locale — the name
        // was there, but no consumer could translate it (`ORT-159`). Named for
        // what it holds rather than for the component that draws it.
        <Sidebar
            collapsible="offcanvas"
            mobileTitle={intl.formatMessage(messages.mobileTitle)}
            mobileDescription={intl.formatMessage(messages.mobileDescription)}
            // Makes the panel a named `complementary` landmark. The brand label
            // in the header, and every group a plugin contributes below the
            // primary `<nav>`, were otherwise outside every landmark (`ORT-170`).
            label={intl.formatMessage(messages.label)}
        >
            {override ?? <GlobalSidebar />}
            {footerItems.length > 0 ? (
                <SidebarFooter className="border-t border-sidebar-border">
                    {footerItems.map(({ id, Component }) => (
                        <Component key={id} />
                    ))}
                </SidebarFooter>
            ) : null}
        </Sidebar>
    );
}
