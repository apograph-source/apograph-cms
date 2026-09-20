import { PERMISSIONS } from '@orthacms/identity-server';
import type {
    ToolContext,
    ToolDefinition,
    ToolRegistry
} from '@orthacms/tools-server';
import type { WorkspaceMembersQuery } from '../member/infrastructure/queries/workspace-members.query';
import { WorkspaceCopilotToolProvider } from './workspace-tool.provider';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
/** The workspace a model might try to reach by putting it in the arguments. */
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

/**
 * `workspace_members_list` — the scoping that is the entire reason this tool
 * exists, and the declaration that keeps it off the MCP endpoint.
 *
 * The workspace comes from the run's context, never from the model's
 * arguments: a copilot run is workspace-scoped, and `users:read` — which every
 * seeded role holds — would otherwise permit listing every account in the
 * deployment through a tool call whose arguments the model writes itself.
 */
describe('WorkspaceCopilotToolProvider', () => {
    /** The query double, recording the arguments the handler forwarded. */
    function queryDouble() {
        const calls: {
            workspaceId: string;
            page: number;
            pageSize: number;
        }[] = [];
        const members = {
            list: async (
                workspaceId: string,
                page: number,
                pageSize: number
            ) => {
                calls.push({ workspaceId, page, pageSize });
                return { items: [], total: 0, page, pageSize };
            }
        } as unknown as WorkspaceMembersQuery;
        return { members, calls };
    }

    /** A minimal run context for `workspaceId`. */
    function context(workspaceId = WORKSPACE_ID): ToolContext {
        return {
            actor: { id: 'actor', permissions: [] },
            workspaceId
        } as unknown as ToolContext;
    }

    /** The single tool this provider contributes. */
    function definition(members?: WorkspaceMembersQuery): ToolDefinition {
        const provider = new WorkspaceCopilotToolProvider(
            members ?? queryDouble().members
        );
        const [tool] = provider.tools();
        return tool;
    }

    describe('handler', () => {
        it('reads the workspace from the run context [users:I-17]', async () => {
            const query = queryDouble();

            await definition(query.members).handler({}, context());

            expect(query.calls[0].workspaceId).toBe(WORKSPACE_ID);
        });

        it('ignores a workspaceId smuggled into the arguments [users:I-17]', async () => {
            const query = queryDouble();

            await definition(query.members).handler(
                { workspaceId: OTHER_WORKSPACE_ID },
                context()
            );

            // The input schema declares `additionalProperties: false`, but the
            // schema validator is defence in depth, not the boundary — the
            // handler never reads the field at all.
            expect(query.calls[0].workspaceId).toBe(WORKSPACE_ID);
        });

        it('defaults to the first page of 25', async () => {
            const query = queryDouble();

            await definition(query.members).handler({}, context());

            expect(query.calls[0]).toMatchObject({ page: 1, pageSize: 25 });
        });

        it.each([
            ['an oversized page size', { pageSize: 999 }, { pageSize: 50 }],
            ['a zero page size', { pageSize: 0 }, { pageSize: 1 }],
            ['a negative page', { page: -3 }, { page: 1 }]
        ])('clamps %s', async (_label, input, expected) => {
            const query = queryDouble();

            await definition(query.members).handler(input, context());

            expect(query.calls[0]).toMatchObject(expected);
        });
    });

    describe('declaration', () => {
        it('gates on users:read and declares itself a read', () => {
            const tool = definition();

            expect(tool.name).toBe('workspace_members_list');
            expect(tool.requires).toEqual([PERMISSIONS.USERS_READ]);
            expect(tool.readOnly).toBe(true);
            expect(tool.effect).toBe('read');
        });

        it('is offered to the copilot surface only', () => {
            // ADR-0007: omitting `surfaces` means **both**, so a dropped field
            // here silently publishes a workspace-scoped tool over MCP, where
            // the caller is an API token rather than a workspace-scoped run.
            expect(definition().surfaces).toEqual(['copilot']);
        });
    });

    describe('registration', () => {
        it('registers with the tool registry when one is present', () => {
            const registered: unknown[] = [];
            const registry = {
                register: (provider: unknown) => registered.push(provider)
            } as unknown as ToolRegistry;
            const provider = new WorkspaceCopilotToolProvider(
                queryDouble().members,
                registry
            );

            provider.onModuleInit();

            expect(registered).toEqual([provider]);
        });

        it('does nothing when no registry is bound [tools:I-18]', () => {
            const provider = new WorkspaceCopilotToolProvider(
                queryDouble().members
            );

            // `@Optional()`: a deployment may run neither the copilot nor MCP,
            // and booting must not depend on one of them being installed.
            expect(() => provider.onModuleInit()).not.toThrow();
        });
    });
});
