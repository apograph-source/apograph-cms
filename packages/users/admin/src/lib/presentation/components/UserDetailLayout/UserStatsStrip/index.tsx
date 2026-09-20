import type { ComponentType } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Building2, CalendarDays, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@orthacms/design-system';
import { MemberRoleChip } from '../../MembersTable/MemberRoleChip';
import type { Member } from '../../../../domain/types/member';

/** Intl descriptors for {@link UserStatsStrip}, co-located with the component. */
const messages = defineMessages({
    memberSince: {
        id: 'users.detail.stats.memberSince',
        defaultMessage: 'Member since'
    },
    workspaces: {
        id: 'users.detail.stats.workspaces',
        defaultMessage: 'Workspaces'
    },
    workspaceCount: {
        id: 'users.detail.stats.workspaceCount',
        defaultMessage:
            '{count, plural, one {# workspace} other {# workspaces}}'
    },
    role: {
        id: 'users.detail.stats.role',
        defaultMessage: 'Role'
    }
});

/** One stat tile: an icon, a label, and its value. */
function StatTile({
    icon: Icon,
    label,
    children
}: {
    icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <Card>
            <CardContent className="flex items-center gap-3 pt-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <div className="text-sm font-medium">{children}</div>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * A three-tile summary above the detail tabs: when the member joined, how many
 * workspaces they belong to, and their global role. Sourced entirely from the
 * shared detail record — no extra requests.
 */
export function UserStatsStrip({ member }: { member: Member }) {
    const intl = useIntl();

    return (
        <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
                icon={CalendarDays}
                label={intl.formatMessage(messages.memberSince)}
            >
                {intl.formatDate(member.joinedAt, { dateStyle: 'medium' })}
            </StatTile>
            <StatTile
                icon={Building2}
                label={intl.formatMessage(messages.workspaces)}
            >
                {intl.formatMessage(messages.workspaceCount, {
                    count: member.workspaces.length
                })}
            </StatTile>
            <StatTile
                icon={ShieldCheck}
                label={intl.formatMessage(messages.role)}
            >
                <MemberRoleChip role={member.role} roleName={member.roleName} />
            </StatTile>
        </div>
    );
}
