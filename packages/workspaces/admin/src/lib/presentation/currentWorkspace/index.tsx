import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { setActiveWorkspaceId } from '@orthacms/utils-admin';
import type { Workspace } from '../../domain/types/workspace';

/**
 * The workspace currently open in the shell. Provided by {@link WorkspaceShell}
 * once it has resolved the `:id` route param against the workspaces list, and
 * read by any page or rail button mounted inside the shell via
 * {@link useCurrentWorkspace} — so a feature plugin never has to re-read the
 * `:id` param or re-fetch the workspace itself.
 */
const CurrentWorkspaceContext = createContext<Workspace | null>(null);

type CurrentWorkspaceProviderProps = {
    /** The resolved workspace to expose to the subtree. */
    workspace: Workspace;
    children: ReactNode;
};

/** Provides the open workspace to everything rendered inside the shell. */
export function CurrentWorkspaceProvider({
    workspace,
    children
}: CurrentWorkspaceProviderProps) {
    // Sync the shared apiClient's workspace header during render — the parent
    // renders before its children, so the header is set before any child's
    // data hook fires its first request (a useEffect here runs *after* those
    // child effects, leaving the first request unscoped). Idempotent.
    setActiveWorkspaceId(workspace.id);

    // Re-assert on mount and whenever the open workspace changes, so switching
    // workspaces re-scopes the shared header. There is deliberately **no unmount
    // cleanup**: nulling the header on unmount races with in-flight/background
    // refetches (e.g. a window-focus refetch of a content list after navigating
    // to the workspaces grid), which would then fire with no `X-Workspace-Id` and
    // 400 at the guard. A lingering id is harmless — the header is only honored by
    // workspace-scoped routes, which always live inside a shell that re-sets it on
    // entry (render-time set above + this effect) before any request runs. This
    // also sidesteps the StrictMode setup → cleanup → setup interim-null window.
    useEffect(() => {
        setActiveWorkspaceId(workspace.id);
    }, [workspace.id]);

    return (
        <CurrentWorkspaceContext.Provider value={workspace}>
            {children}
        </CurrentWorkspaceContext.Provider>
    );
}

/**
 * Returns the workspace currently open in the shell. Throws when called outside
 * a {@link WorkspaceShell} — a workspace page is always mounted inside one, so a
 * missing provider is a wiring bug, not a runtime state to handle.
 */
export function useCurrentWorkspace(): Workspace {
    const workspace = useContext(CurrentWorkspaceContext);
    if (!workspace) {
        throw new Error(
            'useCurrentWorkspace must be used inside a WorkspaceShell route.'
        );
    }
    return workspace;
}
