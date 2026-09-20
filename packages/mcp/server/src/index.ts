/** Public API of @orthacms/mcp-server. */

export { McpPlugin } from './lib/utils/mcp-plugin';
export type {
    McpPluginOptions,
    McpServerPluginDefinition
} from './lib/utils/mcp-plugin';

export { McpModule } from './lib/mcp.module';
export { MCP_CONFIG, InjectMcpConfig } from './lib/mcp.tokens';
export type { McpPluginConfig } from './lib/types/mcp-config';

// The tool seam moved to `@orthacms/tools-server`. It is no longer MCP's to
// own: the copilot's in-process loop injects the same registry, and importing
// it from here would make a deployment that wants only the copilot pull the MCP
// SDK through this barrel. Import `ToolRegistry`, `ToolDefinition`,
// `ToolProvider`, `createToolContext` and `toToolError` from there.
