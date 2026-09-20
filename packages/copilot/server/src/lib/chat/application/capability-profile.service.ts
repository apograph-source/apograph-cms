import { Injectable } from '@nestjs/common';
import { PermissionsService } from '@orthacms/identity-server';
import {
    createToolContext,
    ToolRegistry,
    type ToolActor,
    type ToolContext,
    type ToolDefinition
} from '@orthacms/tools-server';
import {
    resolveCapabilityProfile,
    type CapabilityProfile,
    type CopilotActor
} from '@orthacms/copilot-domain';

/** A run's authority: the profile the model is offered, and the tool context. */
export interface RunAuthority {
    /** The tools offered this run, and what was withheld. */
    profile: CapabilityProfile<ToolDefinition>;
    /** What a tool call is handed — reused for every call in the run. */
    context: ToolContext;
}

/**
 * Resolves the tool set one run may use.
 *
 * **The catalogue is the shared `ToolRegistry`** (ADR-0006 §2) — the same
 * instance the MCP endpoint serves — narrowed to the `copilot` surface. What
 * stays copilot-specific is the pure `resolveCapabilityProfile` in
 * `copilot-domain` and the `withheld` reasons it returns. Keeping that rule
 * pure is what makes "a viewer is offered no write tools" a unit test rather
 * than an e2e hope.
 *
 * **The caller's grants are the whole decision**
 * ([ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)).
 * There used to be a second input — the workspace's auto-apply policy, read
 * here per run — and it is gone along with the table behind it. One resolution
 * per run, one rule.
 *
 * **Nothing here is cached.** [ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §2
 * requires the profile be recomputed per run: permissions can be revoked
 * mid-thread, and a long conversation must not carry stale authority. The cost
 * is one indexed read per run, which the ADR accepts explicitly.
 */
@Injectable()
export class CapabilityProfileService {
    constructor(
        private readonly permissions: PermissionsService,
        private readonly tools: ToolRegistry
    ) {}

    /** The authority for a run by `user` in `workspaceId`. */
    async resolve(
        user: { id: string; email: string; roleId: string },
        workspaceId: string,
        signal?: AbortSignal
    ): Promise<RunAuthority> {
        const granted = new Set(await this.permissions.forRole(user.roleId));

        // `kind: 'user'` is what separates a run from an MCP call in every
        // handler that cares — and `userId` is the *same* id here, because the
        // copilot has no identity of its own and a run acts as the person
        // driving it (ADR-0005 §1).
        const actor: ToolActor = {
            kind: 'user',
            id: user.id,
            displayName: user.email,
            grantedPermissions: granted,
            userId: user.id
        };
        const context: ToolContext = {
            ...createToolContext(actor, workspaceId),
            ...(signal ? { signal } : {})
        };

        const copilotActor: CopilotActor = {
            userId: user.id,
            grantedPermissions: granted
        };
        const profile = resolveCapabilityProfile({
            // The registry authorizes; this decides what to *offer*. Passing
            // the whole surface rather than `visibleTo` keeps the withheld
            // reasons — "you lack content:update" is what the settings page
            // shows, and a pre-filtered list cannot say it.
            tools: this.tools.forSurface('copilot'),
            actor: copilotActor
        });

        return { profile, context };
    }
}
