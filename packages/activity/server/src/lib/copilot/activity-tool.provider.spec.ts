import { PERMISSIONS } from '@orthacms/identity-server';
import type { ActivityService } from '../activity/services/activity.service';
import { ActivityCopilotToolProvider } from './activity-tool.provider';

/**
 * The markings on `activity_recent`.
 *
 * Three of the four are already pinned end to end — `surfaces: ['copilot']` by
 * the MCP catalogue spec, `requires` by a contributor's call being refused, and
 * the optional registry by a host booting without the copilot. `readOnly` and
 * `effect: 'read'` are pinned nowhere, and they are the two a running system
 * never contradicts out loud: they are read by the run engine to decide whether
 * a call needs the caller's confirmation, so getting them wrong makes the audit
 * log *quieter* to use, not louder. A tool marked writing would start prompting;
 * a writing tool marked read-only would stop.
 *
 * Pure data — the definition is built by a method, not by DI — so this needs no
 * module, no registry and no database.
 */

/** The provider with nothing behind it: `tools()` never calls the service. */
function provider() {
    return new ActivityCopilotToolProvider(
        {} as unknown as ActivityService,
        undefined
    );
}

describe('activity_recent', () => {
    it('is the plugin’s only tool [activity:I-21]', () => {
        expect(
            provider()
                .tools()
                .map((tool) => tool.name)
        ).toEqual(['activity_recent']);
    });

    it('is declared read-only, read-effect, copilot-only, activity:read [activity:I-21]', () => {
        const [tool] = provider().tools();

        expect(tool).toMatchObject({
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            requires: [PERMISSIONS.ACTIVITY_READ]
        });
    });

    it('registers nothing when no registry is bound [activity:I-22]', () => {
        // The `@Optional()` half, from this side of the seam: a deployment with
        // neither the copilot nor MCP has no `ToolRegistry` to inject, and
        // `onModuleInit` has to be a no-op rather than a start-up failure.
        expect(() => provider().onModuleInit()).not.toThrow();
    });
});
