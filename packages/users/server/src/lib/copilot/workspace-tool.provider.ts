import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { WorkspaceMembersQuery } from '../member/infrastructure/queries/workspace-members.query';

/** Members a single `workspace_members_list` call may return. */
const MAX_TOOL_PAGE_SIZE = 50;

/**
 * The users plugin's contribution to the copilot's tool catalogue —
 * `workspace_members_list`.
 *
 * It answers "who can I assign this to?" and "who is on this team?", and it is
 * what turns an `actorEmail` from `activity_recent` or an `authorId` on a
 * revision into a person's name.
 *
 * **Scoped to the run's workspace**, via a purpose-built query rather than the
 * users grid's deployment-wide directory. `users:read` would permit listing
 * every account in the deployment; a workspace-scoped run has no business doing
 * that, and the narrower read is also the more useful answer.
 *
 * Nothing security-relevant is returned — email, name, role and account status,
 * exactly the columns the members page renders for the same permission. No
 * invite tokens, no session data, no password state.
 */
@Injectable()
export class WorkspaceCopilotToolProvider
    implements ToolProvider, OnModuleInit
{
    constructor(
        private readonly members: WorkspaceMembersQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the shared tool registry once the DI graph is built —
     * the same catalogue the MCP endpoint serves, narrowed to the `copilot`
     * surface by each tool's `surfaces`. `@Optional()` because a deployment
     * may run neither consumer, in which case these simply go unregistered.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The one workspace-directory tool. */
    tools(): readonly ToolDefinition[] {
        return [this.workspaceMembers()];
    }

    /** `workspace_members_list` — the people in the current workspace. */
    private workspaceMembers(): ToolDefinition {
        return {
            name: 'workspace_members_list',
            title: 'Workspace members',
            description:
                'List the people who are members of the current workspace, with their email, ' +
                'name, global role (admin / contributor / viewer) and account status. Use it ' +
                'to answer “who is on this workspace?”, to suggest who could take a task, or ' +
                'to put a name to an email or user id you saw in another tool’s result. ' +
                'Covers this workspace only, not every account in the CMS.',
            inputSchema: {
                type: 'object',
                properties: {
                    page: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based page number.'
                    },
                    pageSize: {
                        type: 'integer',
                        minimum: 1,
                        maximum: MAX_TOOL_PAGE_SIZE,
                        description: `Members per page (max ${MAX_TOOL_PAGE_SIZE}).`
                    }
                },
                additionalProperties: false
            },
            requires: [PERMISSIONS.USERS_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input, ctx) => {
                const args = (input ?? {}) as {
                    page?: number;
                    pageSize?: number;
                };
                // Clamped here as well as declared: the schema validator is
                // defence in depth, not the boundary.
                const pageSize = Math.min(
                    Math.max(args.pageSize ?? 25, 1),
                    MAX_TOOL_PAGE_SIZE
                );
                return this.members.list(
                    ctx.workspaceId,
                    Math.max(args.page ?? 1, 1),
                    pageSize
                );
            }
        };
    }
}
