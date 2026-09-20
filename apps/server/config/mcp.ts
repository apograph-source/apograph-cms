/** The MCP front door — kill switch, identity, and the two result ceilings. */
import type { McpPluginConfig } from '@orthacms/mcp-server';

import { readFlag, readPositiveInt } from '@orthacms/utils-server';

/** The MCP front door — kill switch, identity, and the two result ceilings. */
export function mcpConfig(): McpPluginConfig {
    return {
        // Off by default, like the copilot's kill switch and for the same
        // reason: enabling it lets any holder of a `full`-scope API token drive
        // content CRUD from an external agent. That is a decision an operator
        // makes deliberately, not one they inherit from an upgrade. Tokens,
        // scopes, and workspace buckets are unchanged — this only controls
        // whether the MCP front door is mounted.
        enabled: readFlag('MCP_ENABLED', false),
        // Stable product configuration, so literals: this is the identity MCP
        // clients display in their connector lists.
        name: 'ortha-cms',
        version: '1.0.0',
        // A request/response transport owes its caller an answer. The registry
        // has no deadline of its own, so without this the only bound on a
        // `tools/call` is the query underneath it — and a blocked pool turns one
        // call into a socket held until the client gives up. 30s is generous for
        // every shipped tool and far short of the load balancer idle timeouts
        // these deployments sit behind.
        callTimeoutMs: readPositiveInt('MCP_CALL_TIMEOUT_MS', 30_000),
        // Deliberately generous: nothing in the catalogue returns this much
        // today, so the ceiling exists to keep a pathological result from being
        // serialised three times over rather than to shape normal use. A result
        // this large does not fit a model's context either.
        maxResultBytes: readPositiveInt('MCP_MAX_RESULT_BYTES', 4_194_304)
    };
}
