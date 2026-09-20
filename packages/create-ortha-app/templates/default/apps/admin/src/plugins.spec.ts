import { describe, expect, it } from 'vitest';
import { buildPlugins } from './plugins';

/**
 * The admin composition, asserted.
 *
 * A browser test proves the happy path assembles, and can say nothing about the
 * two ways this list goes wrong while still rendering something plausible:
 *
 * 1. **A layout registered ahead of the shell's.** The host mounts the *first*
 *    `layout` it finds, and the shell's is what composes identity's auth gate —
 *    so a second contributor placed earlier renders every private route
 *    **ungated** while signed out. It looks like a styling accident.
 * 2. **A plugin quietly dropped.** Its routes and slot contributions stop
 *    existing with no error; the sidebar is simply shorter, and every test that
 *    does not open that page stays green.
 *
 * Both are decisions visible in `plugins.ts`, so they are pinned here rather
 * than through a browser. Relative order between slot fillers is *not* asserted
 * — slots are module-level singletons registered before the first render, so
 * that order only decides the order of items within a slot.
 */

/** Every plugin the admin registers, in order. */
const EXPECTED_PLUGINS = [
    'identity',
    'shell',
    'workspaces',
    'insights',
    'content',
    'i18n',
    'wysiwyg',
    'media',
    'transfer',
    'alarms',
    'copilot',
    'segments',
    'protection',
    'users',
    'activity',
    'api-tokens',
    'webhooks'
];

describe('buildPlugins()', () => {
    it('registers exactly the plugins this admin ships', () => {
        expect(buildPlugins().map((plugin) => plugin.name)).toEqual(
            EXPECTED_PLUGINS
        );
    });

    it('contributes exactly one layout, and it is the shell’s', () => {
        const layouts = buildPlugins().filter((plugin) => plugin.layout);

        expect(layouts.map((plugin) => plugin.name)).toEqual(['shell']);
    });

    it('puts identity first, so its public routes render outside the gate', () => {
        // Sign-in and accept-invite must not be wrapped in the layout that
        // requires a session — otherwise there is no way to get one.
        expect(buildPlugins()[0]?.name).toBe('identity');
    });
});
