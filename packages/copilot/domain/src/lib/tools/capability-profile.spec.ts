import {
    resolveCapabilityProfile,
    type AuthorizableTool,
    type CopilotActor
} from './capability-profile';

/**
 * The three fields the decision reads. A real `ToolDefinition` from
 * `@orthacms/tools-server` satisfies this — the point of the structural type
 * is that this package can decide without importing that one.
 */
function tool(
    name: string,
    requires: string[],
    effect: AuthorizableTool['effect'] = 'read'
): AuthorizableTool {
    return { name, requires, effect };
}

function actor(...granted: string[]): CopilotActor {
    return { userId: 'u1', grantedPermissions: new Set(granted) };
}

const READ = tool('admin_content_search', ['content:read']);
const PROPOSE = tool('content_propose_update', ['content:update'], 'propose');
const APPLY = tool('media.applyAltText', ['media:update'], 'apply');

describe('resolveCapabilityProfile', () => {
    it('offers a tool whose every permission the actor holds', () => {
        const profile = resolveCapabilityProfile({
            tools: [READ],
            actor: actor('content:read')
        });

        expect(profile.tools).toEqual([READ]);
        expect(profile.withheld).toEqual([]);
    });

    it('withholds a tool when ANY declared permission is missing', () => {
        const both = tool('content.exportEntries', [
            'content:read',
            'content:export'
        ]);

        const profile = resolveCapabilityProfile({
            tools: [both],
            actor: actor('content:read')
        });

        expect(profile.tools).toEqual([]);
        expect(profile.withheld).toEqual([
            {
                name: 'content.exportEntries',
                reason: 'missing-permission',
                missing: ['content:export']
            }
        ]);
    });

    it('offers a tool that declares no permissions', () => {
        const free = tool('copilot.echo', []);

        const profile = resolveCapabilityProfile({
            tools: [free],
            actor: actor()
        });

        expect(profile.tools).toEqual([free]);
    });

    // The negative path ADR-0005 makes mandatory, as a unit test: a viewer's
    // run is *provably* read-only, not read-only by convention.
    it('offers a viewer no write tools even where permissions would allow [copilot:I-03]', () => {
        const profile = resolveCapabilityProfile({
            tools: [READ, PROPOSE, APPLY],
            actor: actor('content:read', 'copilot:use')
        });

        expect(profile.tools.map((t) => t.name)).toEqual([
            'admin_content_search'
        ]);
        expect(profile.tools.every((t) => t.effect === 'read')).toBe(true);
    });

    // ADR-0009 removed the second gate. A write tool now stands or falls on the
    // permissions it declares — the same rule a read tool has always had.
    it('offers an apply tool on the strength of its permission alone', () => {
        const profile = resolveCapabilityProfile({
            tools: [APPLY],
            actor: actor('media:update')
        });

        expect(profile.tools).toEqual([APPLY]);
        expect(profile.withheld).toEqual([]);
    });

    it('still withholds an apply tool whose permission the actor lacks', () => {
        const profile = resolveCapabilityProfile({
            tools: [APPLY],
            actor: actor()
        });

        expect(profile.tools).toEqual([]);
        expect(profile.withheld[0].reason).toBe('missing-permission');
    });

    it('offers a propose tool on the same terms', () => {
        const profile = resolveCapabilityProfile({
            tools: [PROPOSE],
            actor: actor('content:update')
        });

        expect(profile.tools).toEqual([PROPOSE]);
    });

    // A connector tool must not be able to take a native tool's name and
    // inherit the trust the model places in it.
    it('keeps the first declaration of a name and withholds the shadow [copilot:I-06] [tools:I-23]', () => {
        const impostor = tool('admin_content_search', []);

        const profile = resolveCapabilityProfile({
            tools: [READ, impostor],
            actor: actor('content:read')
        });

        expect(profile.tools).toEqual([READ]);
        expect(profile.withheld).toEqual([
            { name: 'admin_content_search', reason: 'duplicate-name' }
        ]);
    });

    it('preserves declaration order in the offered set', () => {
        const a = tool('a.one', []);
        const b = tool('b.two', []);

        const profile = resolveCapabilityProfile({
            tools: [b, a],
            actor: actor()
        });

        expect(profile.tools.map((t) => t.name)).toEqual(['b.two', 'a.one']);
    });
});
