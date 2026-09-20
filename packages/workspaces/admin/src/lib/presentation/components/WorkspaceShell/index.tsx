import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Lock, TriangleAlert } from 'lucide-react';
import {
    Button,
    Container,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';
import { useSidebarContent } from '@orthacms/shell-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { CurrentWorkspaceProvider } from '../../currentWorkspace';
import { WORKSPACE_ROUTE_SLOT } from '../../slots/workspaceSlots';
import { WorkspaceShellSkeleton } from '../WorkspacesSkeleton';
import { WorkspaceNav } from '../WorkspaceNav';

/** Intl descriptors for the shell's error/no-access states, co-located here. */
const messages = defineMessages({
    noAccessTitle: {
        id: 'workspaces.shell.noAccessTitle',
        defaultMessage: 'You don’t have access to this workspace'
    },
    noAccessBody: {
        id: 'workspaces.shell.noAccessBody',
        defaultMessage:
            'You’re not a member of this workspace, or it no longer exists. Ask one of its members to add you.'
    },
    backToWorkspaces: {
        id: 'workspaces.shell.backToWorkspaces',
        defaultMessage: 'Back to workspaces'
    },
    errorTitle: {
        id: 'workspaces.shell.errorTitle',
        defaultMessage: 'Couldn’t load workspaces'
    },
    errorBody: {
        id: 'workspaces.shell.errorBody',
        defaultMessage: 'Something went wrong. Please try again.'
    }
});

/**
 * Centered state used for the shell's no-access / load-error screens. Marked
 * `role="alert"` so a screen reader announces it when the shell swaps it in for
 * the workspace the URL asked for.
 */
function ShellMessage({
    icon,
    title,
    body,
    action
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
    action?: React.ReactNode;
}) {
    return (
        <Container>
            <Empty className="mt-10 border" role="alert">
                <EmptyHeader>
                    <EmptyMedia variant="icon">{icon}</EmptyMedia>
                    <EmptyTitle>{title}</EmptyTitle>
                    <EmptyDescription>{body}</EmptyDescription>
                </EmptyHeader>
                {action ? <EmptyContent>{action}</EmptyContent> : null}
            </Empty>
        </Container>
    );
}

/**
 * The workspace shell — the layout behind `/workspaces/:id/*`. It resolves the
 * `:id` param against the workspaces list, **injects the per-workspace nav into
 * the app sidebar** (via `useSidebarContent`), and renders the content area
 * whose nested `<Routes>` are built from {@link WORKSPACE_ROUTE_SLOT}. Landing
 * on the workspace base redirects to the first section. The resolved workspace
 * is published via {@link CurrentWorkspaceProvider} so inner pages read it
 * without re-fetching.
 *
 * Feature plugins (Content Library, Media Library, Insights) don't mount their
 * own top-level routes — they contribute a route plus a nav entry or section to
 * the slots the sidebar reads, which is what keeps them strictly inside a
 * workspace.
 */
export function WorkspaceShell() {
    const intl = useIntl();
    const { id } = useParams();
    const { data: workspaces, isPending, isError } = useWorkspaces();

    const current = workspaces?.find((workspace) => workspace.id === id);

    // Take over the app sidebar's contextual region with this workspace's nav
    // while the shell is mounted; the shell clears it on unmount.
    //
    // `useSidebarContent` stores the *rendered element*, not the render function,
    // so the `workspace` prop captured here is frozen until a dep changes. The
    // deps therefore have to name every field the nav actually renders — keying
    // on the id alone meant renaming, recoloring or archiving a workspace left
    // the switcher showing the old values (including in its `aria-label`) for the
    // rest of the session, while the settings page beside it showed the new ones.
    useSidebarContent(
        () => (current ? <WorkspaceNav workspace={current} /> : null),
        [
            current?.id,
            current?.name,
            current?.color,
            current?.status,
            current?.members.length
        ]
    );

    if (isPending) {
        return <WorkspaceShellSkeleton />;
    }

    if (isError) {
        return (
            <ShellMessage
                icon={<TriangleAlert />}
                title={intl.formatMessage(messages.errorTitle)}
                body={intl.formatMessage(messages.errorBody)}
            />
        );
    }

    // The list only ever contains workspaces the user is a member of (the
    // server scopes `GET /workspaces` to membership), so an unresolved `:id` is
    // exactly the "no access" case — whether the workspace exists or not. We
    // deliberately don't distinguish the two, matching the API's flat 403.
    if (!current) {
        return (
            <ShellMessage
                icon={<Lock />}
                title={intl.formatMessage(messages.noAccessTitle)}
                body={intl.formatMessage(messages.noAccessBody)}
                action={
                    <Button asChild variant="outline" className="shadow-none">
                        <Link to="/workspaces">
                            {intl.formatMessage(messages.backToWorkspaces)}
                        </Link>
                    </Button>
                }
            />
        );
    }

    const routes = WORKSPACE_ROUTE_SLOT.getItems();
    // The default section is the lowest-order route (the Content Library) —
    // where the workspace base and any unknown sub-path redirect to. Its base
    // segment is the route path without the trailing `/*`.
    const defaultRoute = routes
        .slice()
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))[0];
    const defaultPath = defaultRoute?.path.split('/')[0];

    return (
        <CurrentWorkspaceProvider workspace={current}>
            {/* Fills the main inset beside the app sidebar. `h-full`, not
                `min-h-svh`: the inset is already bounded to the viewport, so a
                page that wants an island (the Content Library, the Media
                Library) sizes itself with `flex-1` off THIS element's height
                instead of measuring the viewport a second time — two
                independent svh calculations can round a pixel apart (visibly at
                browser zoom ≠ 100%) and hand the inset a phantom scrollbar
                beside the pane's own. A taller page simply overflows and the
                inset scrolls. */}
            <div className="flex h-full flex-col">
                <Routes>
                    {defaultPath ? (
                        <Route
                            index
                            element={<Navigate to={defaultPath} replace />}
                        />
                    ) : null}
                    {routes.map((route) => (
                        <Route
                            key={route.path}
                            path={route.path}
                            element={route.element}
                        />
                    ))}
                    {defaultPath ? (
                        <Route
                            path="*"
                            element={<Navigate to={defaultPath} replace />}
                        />
                    ) : null}
                </Routes>
            </div>
        </CurrentWorkspaceProvider>
    );
}
