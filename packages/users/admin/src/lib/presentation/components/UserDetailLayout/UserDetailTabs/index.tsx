import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Activity,
    Ban,
    Building2,
    MonitorSmartphone,
    ShieldCheck,
    SlidersHorizontal,
    UserRound
} from 'lucide-react';
import { Badge, TabNav, TabNavLink } from '@orthacms/design-system';
import {
    AuthStatus,
    useAuth,
    useHasPermission
} from '@orthacms/identity-admin';
import type { Member } from '../../../../domain/types/member';

/** Intl descriptors for {@link UserDetailTabs}, co-located with the component. */
const messages = defineMessages({
    general: { id: 'users.detail.rail.general', defaultMessage: 'General' },
    role: { id: 'users.detail.rail.role', defaultMessage: 'Role' },
    workspaces: {
        id: 'users.detail.rail.workspaces',
        defaultMessage: 'Workspaces'
    },
    sessions: { id: 'users.detail.rail.sessions', defaultMessage: 'Sessions' },
    activity: { id: 'users.detail.rail.activity', defaultMessage: 'Activity' },
    signInAccess: {
        id: 'users.detail.rail.signInAccess',
        defaultMessage: 'Sign-in access'
    },
    preferences: {
        id: 'users.detail.rail.preferences',
        defaultMessage: 'Preferences'
    },
    disabled: { id: 'users.detail.rail.disabled', defaultMessage: 'Disabled' },
    nav: { id: 'users.detail.rail.nav', defaultMessage: 'User detail sections' }
});

type TabIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** One tab: an absolute-path `NavLink` whose active state underlines it. */
function UserDetailTab({
    to,
    icon: Icon,
    label,
    trailing
}: {
    to: string;
    icon: TabIcon;
    label: string;
    trailing?: string;
}) {
    return (
        <TabNavLink asChild>
            <NavLink to={to}>
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
                {trailing ? (
                    <Badge variant="destructive-soft">{trailing}</Badge>
                ) : null}
            </NavLink>
        </TabNavLink>
    );
}

/**
 * The detail page's horizontal tab navigation — underline tabs between the
 * hero and the active section. The account tabs (General, Role, Workspaces)
 * are always shown; Sessions/Activity and Sign-in access are gated — without
 * the permission the tab is hidden and its route redirects away, so a
 * read-only admin never sees a dead link. Preferences is **self-only** — it
 * carries the current user's own app settings (theme), so it shows only on
 * their own profile. Links are absolute (`/users/:id/…`) so active state is
 * unambiguous regardless of the matched tab.
 */
export function UserDetailTabs({ member }: { member: Member }) {
    const intl = useIntl();
    const canManage = useHasPermission('users:update');
    const canReadActivity = useHasPermission('activity:read');
    const auth = useAuth();
    const isSelf =
        auth.status === AuthStatus.Authenticated && auth.user.id === member.id;
    const base = `/users/${member.id}`;

    return (
        <TabNav aria-label={intl.formatMessage(messages.nav)}>
            <UserDetailTab
                to={`${base}/general`}
                icon={UserRound}
                label={intl.formatMessage(messages.general)}
            />
            <UserDetailTab
                to={`${base}/roles`}
                icon={ShieldCheck}
                label={intl.formatMessage(messages.role)}
            />
            <UserDetailTab
                to={`${base}/workspaces`}
                icon={Building2}
                label={intl.formatMessage(messages.workspaces)}
            />
            {canManage ? (
                <UserDetailTab
                    to={`${base}/sessions`}
                    icon={MonitorSmartphone}
                    label={intl.formatMessage(messages.sessions)}
                />
            ) : null}
            {canReadActivity ? (
                <UserDetailTab
                    to={`${base}/activity`}
                    icon={Activity}
                    label={intl.formatMessage(messages.activity)}
                />
            ) : null}
            {canManage ? (
                <UserDetailTab
                    to={`${base}/access`}
                    icon={Ban}
                    label={intl.formatMessage(messages.signInAccess)}
                    trailing={
                        member.status === 'disabled'
                            ? intl.formatMessage(messages.disabled)
                            : undefined
                    }
                />
            ) : null}
            {isSelf ? (
                <UserDetailTab
                    to={`${base}/preferences`}
                    icon={SlidersHorizontal}
                    label={intl.formatMessage(messages.preferences)}
                />
            ) : null}
        </TabNav>
    );
}
