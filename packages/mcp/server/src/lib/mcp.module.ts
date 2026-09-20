import { DynamicModule, Module } from '@nestjs/common';
import { ToolRegistry, ToolsModule } from '@orthacms/tools-server';
import { McpAuthService } from './http/mcp-auth.service';
import { McpController } from './http/mcp.controller';
import { MCP_CONFIG } from './mcp.tokens';
import type { McpPluginConfig } from './types/mcp-config';

/**
 * NestJS module for the MCP plugin. Registered globally, like every other
 * plugin module here, so a capability plugin can inject {@link ToolRegistry}
 * and contribute tools without an explicit import.
 *
 * **The registry is available even when the endpoint is disabled**, and the
 * controller is the only thing the kill switch removes. Two reasons: the
 * copilot's in-process tool loop consumes the same registry and has nothing to
 * do with whether an *external* endpoint is exposed, and a contributing plugin
 * should not have to care either way — it registers its tools unconditionally
 * and the composition root decides who may reach them.
 */
@Module({})
export class McpModule {
    /** Creates the global dynamic module around a validated config. */
    static forRoot(config: McpPluginConfig): DynamicModule {
        return {
            module: McpModule,
            global: true,
            // The registry is *imported*, not provided: it is shared with the
            // copilot, and whichever consumer a deployment runs must see the
            // same instance.
            imports: [ToolsModule],
            controllers: config.enabled ? [McpController] : [],
            providers: [
                { provide: MCP_CONFIG, useValue: config },
                McpAuthService
            ],
            exports: [MCP_CONFIG, ToolsModule]
        };
    }
}
