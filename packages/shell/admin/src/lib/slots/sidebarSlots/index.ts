import type { ComponentType } from 'react';
import { createSlot } from '@orthacms/utils-admin';

/**
 * The section a {@link SidebarItem} belongs to in the global sidebar's primary
 * nav. `overview` is the top group (Home, Activity); `directory` is the second
 * (Workspaces, Members). The sidebar renders the groups in this fixed order and
 * sorts entries within each by `order`.
 */
export type SidebarGroupId = 'overview' | 'directory';

/**
 * A navigation entry in the global left sidebar's primary nav. Replaces the old
 * top-toolbar `NavbarItem`: it now carries a `group` (which section it renders
 * under) and always has an `icon`, since sidebar rows are icon + label.
 */
export type SidebarItem = {
    /** react-intl message id for the label. */
    labelId: string;
    /** Fallback label when no translation is available. */
    defaultLabel: string;
    /** Route path this entry links to. */
    to: string;
    /** When true, only the exact path is active (no sub-path matching). */
    end?: boolean;
    /** Which section of the sidebar this entry renders under. */
    group: SidebarGroupId;
    /** Sort order within its group; lower appears first. */
    order: number;
    /** Leading icon (e.g. a lucide-react icon). */
    icon: ComponentType<{ className?: string }>;
    /**
     * Optional accent class for the icon (e.g. `text-nav-orange`), applied
     * only while the row is **active** — the rest of the time the icon stays
     * neutral. The `text-nav-*` utilities are tuned for contrast on the dark
     * sidebar. Omit for an always-neutral icon.
     */
    iconColor?: string;
    /**
     * Optional permission key required to see this entry. When set, the entry
     * is hidden from users whose role doesn't grant it (the UI mirror of the
     * linked route's server-side gate). Omit for an entry visible to every
     * signed-in user (the default — the linked page still gates itself).
     */
    permission?: string;
};

/**
 * The global sidebar's primary-nav slot — the fixed destinations (Home,
 * Activity, Workspaces, Members), rendered under section headers. Any plugin
 * contributes entries via its `slots`; {@link AppSidebar} reads it grouped and
 * sorted by `order`. (Formerly `NAVBAR_START_SLOT`.)
 */
export const SIDEBAR_NAV_SLOT = createSlot<SidebarItem>('shell.sidebar.nav');

/**
 * A data-driven section rendered in the global sidebar below the primary nav.
 * Unlike the declarative {@link SidebarItem}, a section is an arbitrary
 * component the contributing plugin renders itself — so it can be backed by a
 * query (e.g. the "Workspaces" quick-list from `workspaces-admin`, which reads
 * `useWorkspaces`).
 */
export type SidebarSectionItem = {
    /** Stable id (also the React key). */
    id: string;
    /** Sort order; lower appears first. */
    order: number;
    /** The section to render. Receives no props — it reads what it needs. */
    Component: ComponentType;
};

/**
 * The global sidebar's section slot — component-rendered regions below the
 * primary nav. A plugin contributes a {@link SidebarSectionItem} via its
 * `slots`; {@link AppSidebar} renders them sorted by `order`.
 */
export const SIDEBAR_SECTION_SLOT = createSlot<SidebarSectionItem>(
    'shell.sidebar.section'
);

/**
 * A widget pinned to the sidebar footer (account menu, global actions). Like
 * {@link SidebarSectionItem} it is an arbitrary component the contributing
 * plugin renders itself, so it can own its dropdown, current-user data, and
 * actions. The footer is persistent across the global and per-workspace sidebar
 * contexts. (Formerly `NAVBAR_END_SLOT`.)
 */
export type SidebarFooterItem = {
    /** Stable id (also the React key). */
    id: string;
    /** Sort order; lower appears first. */
    order: number;
    /** The widget to render. Receives no props — it reads what it needs (e.g. `useAuth`). */
    Component: ComponentType;
};

/**
 * The sidebar footer slot — account/global actions at the bottom of the
 * sidebar. A plugin contributes a {@link SidebarFooterItem} via its `slots`;
 * {@link AppSidebar} renders them sorted by `order`.
 */
export const SIDEBAR_FOOTER_SLOT = createSlot<SidebarFooterItem>(
    'shell.sidebar.footer'
);
