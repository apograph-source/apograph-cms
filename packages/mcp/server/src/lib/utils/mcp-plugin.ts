import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { McpModule } from '../mcp.module';
import type { McpPluginConfig } from '../types/mcp-config';

/** The MCP plugin shape, with its config attached. */
export type McpServerPluginDefinition = ServerPlugin & {
    mcpConfig: McpPluginConfig;
};

/** Options the host passes to {@link McpPlugin}. */
export interface McpPluginOptions {
    /** Host config — kill switch plus the identity reported to clients. */
    config: McpPluginConfig;
}

/**
 * Validate the wiring **eagerly**, like every other plugin factory here: a
 * blank server name or version is a misconfiguration that should fail at
 * construction rather than surface as a malformed `initialize` response, where
 * it is far more expensive to diagnose.
 */
function assertOptions(options: McpPluginOptions): void {
    if (!options.config.name) {
        throw new Error(
            'McpPlugin requires a non-empty `config.name` — it is the server identity MCP clients display.'
        );
    }
    if (!options.config.version) {
        throw new Error('McpPlugin requires a non-empty `config.version`.');
    }
    assertPositiveInteger(options.config.callTimeoutMs, 'callTimeoutMs');
    assertPositiveInteger(options.config.maxResultBytes, 'maxResultBytes');
}

/**
 * A ceiling that is `0`, negative or `NaN` is worse than no ceiling: a zero
 * timeout fails every call, and `Number(process.env[…]) || default` turns a
 * typo into a silent default. Fail at construction, where the misconfiguration
 * is one line away.
 */
function assertPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
            `McpPlugin requires \`config.${field}\` to be a positive integer, got ${String(
                value
            )}.`
        );
    }
}

/**
 * Creates the MCP plugin — the Model Context Protocol front door onto the CMS.
 *
 * Register it **after** `IdentityPlugin` (bearer tokens are verified through
 * its `ApiTokenService`) and after every plugin that contributes tools, so the
 * intent reads top-to-bottom. DI itself is order-independent: every plugin
 * module is global, and contributors register into {@link ToolRegistry} during
 * `onModuleInit`, which Nest runs once the whole graph is built.
 *
 * The plugin owns **no tables**, so it declares no migrations, and it owns no
 * tools — `content/server` contributes those. Adding another capability's tools
 * is a `ToolProvider` in that plugin plus nothing at all here.
 *
 * @example
 * ```typescript
 * McpPlugin({ config: config.plugins.mcp });
 * ```
 */
export function McpPlugin(
    options: McpPluginOptions
): McpServerPluginDefinition {
    assertOptions(options);
    return {
        name: 'mcp',
        module: McpModule.forRoot(options.config),
        mcpConfig: options.config
    };
}
