import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronRight } from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Skeleton
} from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { isActiveWorkspace } from '../../../domain/isActiveWorkspace';
import { WorkspaceAvatar } from '../WorkspaceAvatar';

/** Intl descriptors for {@link WorkspacesHomePanel}, co-located here. */
const messages = defineMessages({
    title: {
        id: 'workspaces.home.title',
        defaultMessage: 'Workspaces'
    },
    viewAll: {
        id: 'workspaces.home.viewAll',
        defaultMessage: 'View all'
    },
    meta: {
        id: 'workspaces.home.meta',
        defaultMessage:
            '{members, plural, one {# member} other {# members}} · {types, plural, one {# type} other {# types}}'
    },
    empty: {
        id: 'workspaces.home.empty',
        defaultMessage: 'No workspaces yet.'
    },
    error: {
        id: 'workspaces.home.error',
        defaultMessage: 'Couldn’t load workspaces.'
    }
});

/** How many workspaces the home panel previews before "View all". */
const PREVIEW_LIMIT = 5;

/**
 * The home dashboard's Workspaces panel: a preview list of the active
 * workspaces (each a link into its shell) with a "View all" link to the full
 * list. Backed by the real `GET /api/workspaces`.
 */
export function WorkspacesHomePanel() {
    const intl = useIntl();
    const { data: workspaces, isPending, isError } = useWorkspaces();

    const active = (workspaces ?? [])
        .filter(isActiveWorkspace)
        .slice(0, PREVIEW_LIMIT);

    return (
        <Card className="shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle asChild className="text-base">
                    <h2>{intl.formatMessage(messages.title)}</h2>
                </CardTitle>
                <Link
                    to="/workspaces"
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    {intl.formatMessage(messages.viewAll)}
                </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
                {isPending ? (
                    Array.from({ length: 3 }).map((_, index) => (
                        <div
                            key={index}
                            className="flex items-center gap-3 rounded-lg px-2 py-2"
                        >
                            <Skeleton className="size-9 shrink-0 rounded-lg" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-40" />
                            </div>
                        </div>
                    ))
                ) : isError ? (
                    <p
                        role="alert"
                        className="px-2 py-6 text-center text-sm text-destructive"
                    >
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : active.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    active.map((workspace) => (
                        <Link
                            key={workspace.id}
                            to={`/workspaces/${workspace.id}`}
                            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <WorkspaceAvatar
                                initials={initialsOf(workspace.name)}
                                color={workspace.color}
                                className="size-9 shrink-0 rounded-lg text-xs"
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">
                                    {workspace.name}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {intl.formatMessage(messages.meta, {
                                        members: workspace.members.length,
                                        types: workspace.content.length
                                    })}
                                </span>
                            </span>
                            <ChevronRight
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                        </Link>
                    ))
                )}
            </CardContent>
        </Card>
    );
}
