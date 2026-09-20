/**
 * Public API of `@orthacms/tools-server` — the shared, transport-neutral
 * catalogue of everything an agent can do to this CMS, and the single place a
 * tool call is authorized.
 *
 * It lives in its own package rather than inside `mcp/server` (where
 * [ADR-0006](../../../docs/adr/0006-cms-as-an-mcp-server.md) §2 first put it)
 * because MCP turned out to be one consumer of two, not the owner: the
 * copilot's in-process tool loop injects the same registry. Importing it from
 * the MCP package would have made a deployment that wants only the copilot pull
 * `@modelcontextprotocol/sdk` through that package's barrel — a dependency on a
 * protocol it does not speak.
 */

export { ToolRegistry } from './lib/tool-registry';
// The module that provides it. Imported by each consumer (MCP, copilot) rather
// than provided by either — see its JSDoc.
export { ToolsModule } from './lib/tools.module';
export type { ToolProvider } from './lib/tool-provider';
export type {
    JsonSchema,
    ResourceContents,
    ResourceDefinition,
    ToolActor,
    ToolActorKind,
    ToolContext,
    ToolDefinition,
    ToolEffect,
    ToolOutput,
    ToolSurface
} from './lib/tool';

// Building a context is exported because neither consumer owns it: the MCP
// endpoint builds one for a bearer token, the copilot for the signed-in user.
export { createToolContext } from './lib/tool-context';

export { toToolError } from './lib/tool-error';
export type { ToolError } from './lib/tool-error';

// The argument check `ToolRegistry.call` applies before dispatch. Exported
// because a consumer may want to reject a malformed call earlier than the
// registry does — the copilot's run engine validates at the point it decides
// what to tell the model, so the run continues instead of throwing.
export { validateToolInput } from './lib/validate-tool-input';
export type { ToolInputValidation } from './lib/validate-tool-input';
