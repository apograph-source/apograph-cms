import { Link, useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { initialsOf } from '@orthacms/utils-admin';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    cn
} from '@orthacms/design-system';
import { WorkspaceAvatar } from '../WorkspaceAvatar';
import { StatusChip } from '../StatusChip';
import { isActiveWorkspace } from '../../../domain/isActiveWorkspace';
import type { Workspace } from '../../../domain/types/workspace';

/** Intl descriptors for {@link WorkspacesTable}, co-located with the component. */
const messages = defineMessages({
    caption: {
        id: 'workspaces.table.caption',
        defaultMessage: 'Workspaces'
    },
    workspace: {
        id: 'workspaces.table.workspace',
        defaultMessage: 'Workspace'
    },
    members: {
        id: 'workspaces.table.members',
        defaultMessage: 'Members'
    },
    types: {
        id: 'workspaces.table.types',
        defaultMessage: 'Content types'
    },
    status: {
        id: 'workspaces.table.status',
        defaultMessage: 'Status'
    },
    memberCount: {
        id: 'workspaces.table.memberCount',
        defaultMessage: '{count, plural, one {# member} other {# members}}'
    },
    typeCount: {
        id: 'workspaces.table.typeCount',
        defaultMessage: '{count, plural, one {# type} other {# types}}'
    }
});

/**
 * The workspaces list as a table (mirroring the members table): each row is a
 * workspace — avatar + name + description, its member and content-type counts,
 * and a status pill. The whole row opens the workspace (its shell redirects to
 * the first section); the name is a real link for keyboard users, and stops the
 * click from bubbling so it navigates exactly once. Archived rows read muted.
 */
export function WorkspacesTable({ workspaces }: { workspaces: Workspace[] }) {
    const intl = useIntl();
    const navigate = useNavigate();

    return (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table aria-label={intl.formatMessage(messages.caption)}>
                <TableHeader>
                    <TableRow>
                        <TableHead scope="col" className="whitespace-nowrap">
                            {intl.formatMessage(messages.workspace)}
                        </TableHead>
                        <TableHead scope="col" className="whitespace-nowrap">
                            {intl.formatMessage(messages.members)}
                        </TableHead>
                        <TableHead scope="col" className="whitespace-nowrap">
                            {intl.formatMessage(messages.types)}
                        </TableHead>
                        <TableHead scope="col" className="whitespace-nowrap">
                            {intl.formatMessage(messages.status)}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {workspaces.map((workspace) => {
                        const isArchived = !isActiveWorkspace(workspace);
                        return (
                            <TableRow
                                key={workspace.id}
                                onClick={() =>
                                    navigate(`/workspaces/${workspace.id}`)
                                }
                                className={cn(
                                    'cursor-pointer',
                                    isArchived && 'bg-muted/30'
                                )}
                            >
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <WorkspaceAvatar
                                            initials={initialsOf(
                                                workspace.name
                                            )}
                                            color={workspace.color}
                                            className="size-9 shrink-0 text-xs"
                                        />
                                        <div className="min-w-0 max-w-md">
                                            <Link
                                                to={`/workspaces/${workspace.id}`}
                                                className="block truncate text-sm font-medium hover:underline"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                {workspace.name}
                                            </Link>
                                            <p className="line-clamp-3 text-xs break-words text-muted-foreground">
                                                {workspace.description}
                                            </p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {intl.formatMessage(messages.memberCount, {
                                        count: workspace.members.length
                                    })}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {intl.formatMessage(messages.typeCount, {
                                        count: workspace.content.length
                                    })}
                                </TableCell>
                                <TableCell>
                                    <StatusChip status={workspace.status} />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
