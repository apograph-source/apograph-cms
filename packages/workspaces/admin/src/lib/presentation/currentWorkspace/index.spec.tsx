import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CurrentWorkspaceProvider, useCurrentWorkspace } from './index';
import type { Workspace } from '../../domain/types/workspace';

// The provider syncs the shared apiClient header on render; the header itself is
// the transport's business, not this unit's, so it is stubbed out.
vi.mock('@orthacms/utils-admin', () => ({
    setActiveWorkspaceId: vi.fn()
}));

const workspace: Workspace = {
    id: 'ws_1',
    name: 'Marketing site',
    slug: 'marketing-site',
    description: '',
    color: 'violet',
    status: 'Active',
    members: [],
    content: []
};

/**
 * `useCurrentWorkspace` is the one invariant in this package a browser test
 * can't reach: `admin-e2e` can only render routes the app actually mounts, and
 * every workspace page is mounted *inside* the shell by construction. The
 * failure mode it guards — a feature plugin mounting a workspace page outside
 * `WorkspaceShell` — is a wiring mistake that has to surface loudly rather than
 * as an undefined workspace read three components deeper.
 */
describe('useCurrentWorkspace', () => {
    it('returns the workspace the shell resolved', () => {
        const { result } = renderHook(() => useCurrentWorkspace(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <CurrentWorkspaceProvider workspace={workspace}>
                    {children}
                </CurrentWorkspaceProvider>
            )
        });

        expect(result.current).toBe(workspace);
    });

    it('throws when used outside a WorkspaceShell route', () => {
        // React logs the thrown render error; silence it so the run's output
        // reports the assertion rather than an expected stack.
        const error = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        expect(() => renderHook(() => useCurrentWorkspace())).toThrow(
            /must be used inside a WorkspaceShell route/
        );

        error.mockRestore();
    });
});
