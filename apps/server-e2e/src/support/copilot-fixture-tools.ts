import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';

/**
 * Fixture tools, registered by the copilot suite only.
 *
 * They exist because phase 1 ships **no write tools at all** — every real tool
 * is `content:read`. Without something that mutates, "a viewer is offered no
 * write tools" would be a vacuously passing assertion, and ADR-0005 is explicit
 * that this negative path is mandatory rather than nice to have. These give it
 * something real to be false about, and let the `apply`-not-opted-in branch be
 * exercised end to end instead of only in the domain unit test.
 *
 * They are `surfaces: ['copilot']` like every other copilot tool, so registering
 * them cannot leak a fixture into the MCP endpoint's `tools/list` and break the
 * MCP suite's exact-catalogue assertions.
 */
export class FixtureToolProvider implements ToolProvider {
    /** Names of tools whose `run` was actually invoked, in order. */
    readonly invoked: string[] = [];

    tools(): readonly ToolDefinition[] {
        return [
            {
                name: 'fixture.readThing',
                title: 'Fixture read',
                description: 'A read tool any role with content:read may use.',
                inputSchema: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                    required: ['q'],
                    additionalProperties: false
                },
                requires: ['content:read'],
                readOnly: true,
                effect: 'read',
                surfaces: ['copilot'],
                handler: async (input) => {
                    this.invoked.push('fixture.readThing');
                    return { echoed: (input as { q: string }).q, total: 3 };
                }
            },
            {
                name: 'fixture.proposeThing',
                title: 'Fixture propose',
                description: 'A propose tool needing content:update.',
                inputSchema: { type: 'object', properties: {} },
                requires: ['content:update'],
                readOnly: false,
                effect: 'propose',
                surfaces: ['copilot'],
                handler: async () => {
                    this.invoked.push('fixture.proposeThing');
                    return { proposed: true };
                }
            },
            {
                name: 'fixture.applyThing',
                title: 'Fixture apply',
                description: 'An apply tool needing content:update.',
                inputSchema: { type: 'object', properties: {} },
                requires: ['content:update'],
                readOnly: false,
                effect: 'apply',
                surfaces: ['copilot'],
                handler: async () => {
                    this.invoked.push('fixture.applyThing');
                    return { applied: true };
                }
            },
            {
                name: 'fixture.explodes',
                title: 'Fixture thrower',
                description: 'A read tool that always throws.',
                inputSchema: { type: 'object', properties: {} },
                requires: ['content:read'],
                readOnly: true,
                effect: 'read',
                surfaces: ['copilot'],
                handler: async () => {
                    this.invoked.push('fixture.explodes');
                    throw new Error('the tool blew up');
                }
            }
        ];
    }
}
