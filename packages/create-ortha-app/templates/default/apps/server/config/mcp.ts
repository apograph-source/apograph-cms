// ortha:if mcp
import type { McpPluginConfig } from '@orthacms/mcp-server';
import { readFlag, readPositiveInt } from '@orthacms/utils-server';

/** The MCP front door — off unless an operator turns it on. */
export function mcpConfig(): McpPluginConfig {
    return {
        // Off by default: once on, any holder of a full-scope API token can
        // drive content CRUD from an external agent.
        enabled: readFlag('MCP_ENABLED', false),
        // The identity MCP clients display in their connector lists.
        name: '__APP_NAME__',
        version: '1.0.0',
        // A request/response transport owes its caller an answer, and the tool
        // registry has no deadline of its own — so without this the only bound
        // on a `tools/call` is the query underneath it, and a blocked pool
        // turns one call into a socket held until the client gives up.
        callTimeoutMs: readPositiveInt('MCP_CALL_TIMEOUT_MS', 30_000),
        // Deliberately generous: the ceiling exists to stop a pathological
        // result being serialised several times over, not to shape normal use.
        // A result this large does not fit a model's context anyway.
        maxResultBytes: readPositiveInt('MCP_MAX_RESULT_BYTES', 4_194_304)
    };
}
// ortha:end
