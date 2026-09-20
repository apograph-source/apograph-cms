import { Link, useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import { MemberAvatar } from '../MemberAvatar';
import { MemberRoleChip } from './MemberRoleChip';
import { MemberRowActions } from './MemberRowActions';
import { MemberStatusBadge } from './MemberStatusBadge';
import { MemberWorkspaces } from './MemberWorkspaces';
import type { Member } from '../../../domain/types/member';

/** Intl descriptors for {@link MembersTable}, co-located with the component. */
const messages = defineMessages({
    member: {
        id: 'users.table.member',
        defaultMessage: 'Member'
    },
    role: {
        id: 'users.table.role',
        defaultMessage: 'Role'
    },
    status: {
        id: 'users.table.status',
        defaultMessage: 'Status'
    },
    workspaces: {
        id: 'users.table.workspaces',
        defaultMessage: 'Workspaces'
    },
    joined: {
        id: 'users.table.joined',
        defaultMessage: 'Joined'
    },
    actions: {
        id: 'users.table.actions',
        defaultMessage: 'Actions'
    },
    caption: {
        id: 'users.table.caption',
        defaultMessage: 'Members'
    }
});

/**
 * The members table: avatar + name + email, the role chip, the status pill, the
 * workspace stack, the joined date (the invite date for Invited rows), and the
 * per-row actions menu. The whole row is a shortcut to the member's detail page
 * (the name is a real link for keyboard users); the actions cell stops the
 * click from bubbling so opening the menu doesn't also navigate.
 */
export function MembersTable({ members }: { members: Member[] }) {
    const intl = useIntl();
    const navigate = useNavigate();

    return (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table aria-label={intl.formatMessage(messages.caption)}>
                <TableHeader>
                    <TableRow>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.member)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.role)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.status)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.workspaces)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.joined)}
                        </TableHead>
                        <TableHead scope="col" className="w-12">
                            <span className="sr-only">
                                {intl.formatMessage(messages.actions)}
                            </span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {members.map((member) => (
                        <TableRow
                            key={member.id}
                            onClick={() => navigate(`/users/${member.id}`)}
                            className="cursor-pointer"
                        >
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <MemberAvatar
                                        initials={member.initials}
                                        color={member.color}
                                        className="size-9 shrink-0 text-xs"
                                    />
                                    {/* `max-w-*`, not just `min-w-0`: the cell
                                    auto-sizes to its content, so a very long
                                    display name widens the column and pushes the
                                    row's kebab off-screen. Capping the block is
                                    what actually lets `truncate` engage. */}
                                    <div className="min-w-0 max-w-[22rem]">
                                        <Link
                                            to={`/users/${member.id}`}
                                            className="block truncate text-sm font-medium hover:underline"
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            {member.name}
                                        </Link>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {member.email}
                                        </p>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <MemberRoleChip
                                    role={member.role}
                                    roleName={member.roleName}
                                />
                            </TableCell>
                            <TableCell>
                                <MemberStatusBadge status={member.status} />
                            </TableCell>
                            <TableCell>
                                <MemberWorkspaces
                                    workspaces={member.workspaces}
                                />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                                {intl.formatDate(member.joinedAt, {
                                    dateStyle: 'medium'
                                })}
                            </TableCell>
                            <TableCell
                                className="text-right"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <MemberRowActions member={member} />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
