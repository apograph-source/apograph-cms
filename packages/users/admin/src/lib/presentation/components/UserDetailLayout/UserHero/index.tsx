import { defineMessages, useIntl } from 'react-intl';
import { Card, CardContent } from '@orthacms/design-system';
import { MemberAvatar } from '../../MemberAvatar';
import { MemberRoleChip } from '../../MembersTable/MemberRoleChip';
import { MemberStatusBadge } from '../../MembersTable/MemberStatusBadge';
import type { Member } from '../../../../domain/types/member';

/** Intl descriptors for {@link UserHero}, co-located with the component. */
const messages = defineMessages({
    memberSince: {
        id: 'users.detail.hero.memberSince',
        defaultMessage: 'Member since {date}'
    }
});

/**
 * The detail page's identity card: a large initials avatar, the member's name
 * and email, their status and role badges, and the join date. Read-only — every
 * edit lives in a tab below.
 */
export function UserHero({ member }: { member: Member }) {
    const intl = useIntl();

    return (
        <Card>
            <CardContent className="flex items-center gap-4 pt-6">
                <MemberAvatar
                    initials={member.initials}
                    color={member.color}
                    className="size-16 shrink-0 text-lg"
                />
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="truncate text-xl font-semibold">
                            {member.name}
                        </h1>
                        <MemberStatusBadge status={member.status} />
                        <MemberRoleChip
                            role={member.role}
                            roleName={member.roleName}
                        />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                        {member.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.memberSince, {
                            date: intl.formatDate(member.joinedAt, {
                                dateStyle: 'long'
                            })
                        })}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
