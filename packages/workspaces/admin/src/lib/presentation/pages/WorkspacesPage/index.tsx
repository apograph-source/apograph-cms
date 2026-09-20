import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageTopBar } from '@orthacms/shell-admin';
import { Layers, Plus } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader
} from '@orthacms/design-system';
import { useDocumentTitle } from '@orthacms/utils-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { WorkspacesTable } from '../../components/WorkspacesTable';
import { WorkspacesTableSkeleton } from '../../components/WorkspacesSkeleton';
import { WorkspacesEmpty } from '../../components/WorkspacesEmpty';
import {
    WorkspaceToolbar,
    DEFAULT_STATUS,
    type StatusFilter
} from '../../components/WorkspaceToolbar';
import type { Workspace } from '../../../domain/types/workspace';
import { useRedirectNotice } from '../../hooks/useRedirectNotice';

/** Intl descriptors for {@link WorkspacesPage}, co-located with the component. */
const messages = defineMessages({
    createDenied: {
        id: 'workspaces.list.createDenied',
        defaultMessage:
            'You don’t have permission to create a workspace, so we brought you back to the workspaces list.'
    },
    title: {
        id: 'workspaces.page.title',
        defaultMessage: 'Workspaces'
    },
    subtitle: {
        id: 'workspaces.page.subtitle',
        defaultMessage:
            'Each workspace groups its own content, members, and plugins. Switch in to manage one, or spin up a new one.'
    },
    newWorkspace: {
        id: 'workspaces.page.newWorkspace',
        defaultMessage: 'New workspace'
    },
    error: {
        id: 'workspaces.page.error',
        defaultMessage: 'Couldn’t load workspaces. Please try again.'
    },
    retry: {
        id: 'workspaces.page.retry',
        defaultMessage: 'Retry'
    }
});

/** Matches a workspace against the status filter. */
function matchesStatus(workspace: Workspace, status: StatusFilter): boolean {
    return status === 'All' || workspace.status === status;
}

/** Matches a workspace name or description against the search query. */
function matchesSearch(workspace: Workspace, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
        workspace.name.toLowerCase().includes(needle) ||
        workspace.description.toLowerCase().includes(needle)
    );
}

/**
 * The Workspaces management page: a searchable, status-filterable **table** of
 * workspaces with a create flow. Rendered at `/workspaces` inside the
 * authenticated shell.
 */
export function WorkspacesPage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const canCreate = useHasPermission('workspaces:create');
    const redirectNotice = useRedirectNotice();
    useDocumentTitle(intl.formatMessage(messages.title));
    const {
        data: workspaces = [],
        isLoading,
        isError,
        refetch
    } = useWorkspaces();

    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>(DEFAULT_STATUS);

    const openCreate = () => navigate('/workspaces/new');

    const filtered = useMemo(
        () =>
            workspaces.filter(
                (workspace) =>
                    matchesStatus(workspace, status) &&
                    matchesSearch(workspace, search)
            ),
        [workspaces, status, search]
    );

    // Per-status counts for the filter chips — over the full list, not the
    // current view, so each chip shows how many it would reveal.
    const counts = useMemo<Record<StatusFilter, number>>(
        () => ({
            All: workspaces.length,
            Active: workspaces.filter((w) => w.status === 'Active').length,
            Archived: workspaces.filter((w) => w.status === 'Archived').length
        }),
        [workspaces]
    );

    // Resets back to the widest view. Clearing lands on `All` (not the default
    // `Active`) so it reveals every workspace — including archived ones the
    // default view hides — matching the empty-state's "see them all" copy. This
    // also unsticks the all-archived case, where resetting to `Active` would
    // leave the table empty and the clear button a no-op.
    const clearFilters = () => {
        setSearch('');
        setStatus('All');
    };

    return (
        <>
            <PageTopBar
                icon={Layers}
                iconClassName="bg-violet-soft text-violet-soft-foreground"
                crumbs={[
                    {
                        key: 'workspaces',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                {/* A gated redirect landed here; say so, since the page simply
                    swapped under the user with no other signal. */}
                <span role="status" aria-live="polite" className="sr-only">
                    {redirectNotice === 'create-denied'
                        ? intl.formatMessage(messages.createDenied)
                        : ''}
                </span>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                    actions={
                        canCreate ? (
                            <Button onClick={openCreate}>
                                <Plus />
                                {intl.formatMessage(messages.newWorkspace)}
                            </Button>
                        ) : undefined
                    }
                />

                <WorkspaceToolbar
                    search={search}
                    onSearchChange={setSearch}
                    status={status}
                    onStatusChange={setStatus}
                    counts={counts}
                    shown={filtered.length}
                    total={workspaces.length}
                />

                {isLoading ? (
                    <WorkspacesTableSkeleton />
                ) : isError ? (
                    // A failed load gets its own state — never the empty-list
                    // "create your first workspace" copy, which would mislead the
                    // operator into thinking the account genuinely has none.
                    <Alert variant="destructive" role="alert" className="mt-4">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>{intl.formatMessage(messages.error)}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="shadow-none"
                                onClick={() => refetch()}
                            >
                                {intl.formatMessage(messages.retry)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : filtered.length === 0 ? (
                    <WorkspacesEmpty
                        // "No match / clear filters" whenever workspaces exist but
                        // the current view hides them all (e.g. a search miss, or
                        // the default Active filter with only archived workspaces);
                        // the "no workspaces yet / create first" variant is reserved
                        // for a genuinely empty list.
                        filtered={workspaces.length > 0}
                        canCreate={canCreate}
                        onClear={clearFilters}
                        onCreate={openCreate}
                    />
                ) : (
                    <WorkspacesTable workspaces={filtered} />
                )}
            </Container>
        </>
    );
}
