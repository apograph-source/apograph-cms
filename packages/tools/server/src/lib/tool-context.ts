import type { PermissionKey } from '@orthacms/identity-server';
import type { ToolActor, ToolContext } from './tool';

/**
 * Build a {@link ToolContext} from an already-resolved actor and workspace.
 *
 * Exported because the MCP endpoint is not the only thing that builds one: the
 * copilot's tool loop runs as the **signed-in user**, resolves that user's role
 * grants through identity's RBAC service, and calls the same registry. Sharing
 * the constructor keeps `can()` meaning one thing.
 *
 * Note what this function does **not** do: it never derives permissions. The
 * caller resolves them (a token's scope via `scopePermissions`, a user's via
 * their role) and hands them over. Authorization inputs are decided once, at
 * the edge, by the code that authenticated the caller.
 */
export function createToolContext(
    actor: ToolActor,
    workspaceId: string
): ToolContext {
    return {
        actor,
        workspaceId,
        can: (permission: PermissionKey): boolean =>
            actor.grantedPermissions.has(permission)
    };
}
