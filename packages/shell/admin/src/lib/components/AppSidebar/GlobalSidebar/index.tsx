import { defineMessages, useIntl } from 'react-intl';
import { AuthStatus, useAuth } from '@apograph/identity-admin';
import {
    Logo,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarTrigger
} from '@apograph/design-system';
import { byOrder } from '@apograph/utils-admin';
import {
    SIDEBAR_NAV_SLOT,
    SIDEBAR_SECTION_SLOT,
    type SidebarGroupId,
    type SidebarItem
} from '../../../slots/sidebarSlots';
import { SidebarNavButton } from '../SidebarNavButton';
import { SidebarSearch } from '../SidebarSearch';

/** Intl descriptors for the global sidebar, co-located here. */
const messages = defineMessages({
    hideNav: {
        id: 'shell.sidebar.hide',
        defaultMessage: 'Hide navigation'
    },
    primaryNav: {
        id: 'shell.sidebar.primaryLabel',
        defaultMessage: 'Primary'
    },
    overview: {
        id: 'shell.sidebar.group.overview',
        defaultMessage: 'Overview'
    },
    directory: {
        id: 'shell.sidebar.group.directory',
        defaultMessage: 'Directory'
    }
});

/** The primary-nav groups, in render order. */
const GROUPS: {
    id: SidebarGroupId;
    label: (typeof messages)[keyof typeof messages];
}[] = [
    { id: 'overview', label: messages.overview },
    { id: 'directory', label: messages.directory }
];

/**
 * The default (non-workspace) contents of {@link AppSidebar}: the brand, the
 * search trigger, the primary nav grouped into Overview / Directory (from
 * {@link SIDEBAR_NAV_SLOT}), and any data-driven sections below it (from
 * {@link SIDEBAR_SECTION_SLOT} — e.g. the Workspaces quick-list). Rendered
 * whenever no route has taken over the sidebar's contextual region.
 */
export function GlobalSidebar() {
    const intl = useIntl();
    const items = byOrder(SIDEBAR_NAV_SLOT.getItems());
    const sections = byOrder(SIDEBAR_SECTION_SLOT.getItems());

    // Mirror the exact visibility rule `SidebarNavButton` applies per row (see
    // `useHasPermission`): an item with no `permission` is always visible, one
    // with a `permission` only when the signed-in user holds it. Reading the
    // permission set once lets the group compute visibility without calling a
    // hook per item, so a group whose every item is gated out renders neither
    // its label nor an empty body.
    const auth = useAuth();
    const permissions =
        auth.status === AuthStatus.Authenticated ? auth.user.permissions : [];
    const isVisible = (item: SidebarItem) =>
        !item.permission || permissions.includes(item.permission);

    return (
        <>
            <SidebarHeader className="gap-3 px-3 pt-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                        <Logo showLabel={false} aria-hidden />
                        <span className="text-sm font-semibold">
                            Apograph CMS
                        </span>
                    </span>
                    {/* In-header trigger, only reachable while the sidebar is
                        open — so it always *hides* (`ORT-159`). */}
                    <SidebarTrigger
                        label={intl.formatMessage(messages.hideNav)}
                        className="text-sidebar-foreground/70"
                    />
                </div>
                <SidebarSearch />
            </SidebarHeader>
            <SidebarContent>
                <nav aria-label={intl.formatMessage(messages.primaryNav)}>
                    {GROUPS.map((group) => {
                        const groupItems = items.filter(
                            (item: SidebarItem) =>
                                item.group === group.id && isVisible(item)
                        );
                        if (groupItems.length === 0) {
                            return null;
                        }
                        return (
                            <SidebarGroup key={group.id}>
                                <SidebarGroupLabel>
                                    {intl.formatMessage(group.label)}
                                </SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {groupItems.map((item) => (
                                            <SidebarNavButton
                                                key={item.to}
                                                item={item}
                                            />
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        );
                    })}
                </nav>
                {sections.map(({ id, Component }) => (
                    <Component key={id} />
                ))}
            </SidebarContent>
        </>
    );
}
