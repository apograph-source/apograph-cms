import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    FileStack,
    SlidersHorizontal,
    TriangleAlert,
    Users
} from 'lucide-react';
import { TabNav, TabNavLink } from '@orthacms/design-system';
import { WORKSPACE_SETTINGS_TAB_SLOT } from '../../slots/workspaceSlots';
import { SettingsTabLink } from './SettingsTabLink';

/** Intl descriptors for {@link WorkspaceSettingsTabs}, co-located here. */
const messages = defineMessages({
    nav: {
        id: 'workspaces.settings.rail.nav',
        defaultMessage: 'Workspace settings sections'
    },
    general: {
        id: 'workspaces.settings.rail.general',
        defaultMessage: 'General'
    },
    members: {
        id: 'workspaces.settings.rail.members',
        defaultMessage: 'Members'
    },
    content: {
        id: 'workspaces.settings.rail.content',
        defaultMessage: 'Content'
    },
    danger: {
        id: 'workspaces.settings.rail.danger',
        defaultMessage: 'Danger zone'
    }
});

type TabIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** One tab entry: an absolute-path `NavLink` whose active state underlines it. */
type TabEntry = {
    /** Absolute route the entry links to. */
    to: string;
    /** Leading icon. */
    icon: TabIcon;
    /** Localized label. */
    label: string;
};

/**
 * The settings page's horizontal tab navigation — underline tabs under the
 * page header, mirroring the user-detail tabs. Absolute links
 * (`/workspaces/:id/settings/...`) so active state is unambiguous. The
 * Danger-zone entry is included only when the user can act on it (its route
 * redirects away otherwise), so a read-only viewer never sees a dead link.
 *
 * Plugin-contributed tabs ({@link WORKSPACE_SETTINGS_TAB_SLOT}) render
 * **between Content and Danger zone**, each through a {@link SettingsTabLink}
 * that gates itself: a permission check is a hook, and the alternative — one
 * `useHasPermission` per item inside a `.map` — is a hook call whose position
 * depends on the list. Slot items are frozen at boot so the list cannot move,
 * but writing it that way makes the next contributor's change a rules-of-hooks
 * bug rather than an addition.
 */
export function WorkspaceSettingsTabs({
    workspaceId,
    showDanger
}: {
    /** The open workspace id — the base for every link. */
    workspaceId: string;
    /** Whether to show the Danger-zone entry (update or delete permission). */
    showDanger: boolean;
}) {
    const intl = useIntl();
    const base = `/workspaces/${workspaceId}/settings`;

    const leading: TabEntry[] = [
        {
            to: `${base}/general`,
            icon: SlidersHorizontal,
            label: intl.formatMessage(messages.general)
        },
        {
            to: `${base}/members`,
            icon: Users,
            label: intl.formatMessage(messages.members)
        },
        {
            to: `${base}/content`,
            icon: FileStack,
            label: intl.formatMessage(messages.content)
        }
    ];

    const trailing: TabEntry[] = showDanger
        ? [
              {
                  to: `${base}/danger`,
                  icon: TriangleAlert,
                  label: intl.formatMessage(messages.danger)
              }
          ]
        : [];

    const contributed = WORKSPACE_SETTINGS_TAB_SLOT.getItems().sort(
        (a, b) => a.order - b.order
    );

    return (
        <TabNav aria-label={intl.formatMessage(messages.nav)}>
            {leading.map(({ to, icon: Icon, label }) => (
                <TabNavLink key={to} asChild>
                    <NavLink to={to}>
                        <Icon aria-hidden className="size-4 shrink-0" />
                        {label}
                    </NavLink>
                </TabNavLink>
            ))}
            {contributed.map((tab) => (
                <SettingsTabLink key={tab.id} base={base} tab={tab} />
            ))}
            {trailing.map(({ to, icon: Icon, label }) => (
                <TabNavLink key={to} asChild>
                    <NavLink to={to}>
                        <Icon aria-hidden className="size-4 shrink-0" />
                        {label}
                    </NavLink>
                </TabNavLink>
            ))}
        </TabNav>
    );
}
