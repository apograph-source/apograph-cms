import { describe, expect, it } from 'vitest';
import { SIDEBAR_NAV_SLOT, type SidebarItem } from '@orthacms/shell-admin';
import { buildPlugins } from './plugins';

/**
 * The shipped admin composition, asserted.
 *
 * `apps/admin-e2e` drives the assembled app, which proves the happy path
 * assembles — and can say nothing about the two ways this list can be wrong
 * while still rendering something plausible:
 *
 * 1. **A layout ahead of the shell's.** `createAdmin` mounts the *first* plugin
 *    `layout` it finds. The shell's is what composes identity's `RequireAuth`, so
 *    a second contributor registered earlier does not merely change the chrome —
 *    every private route renders **ungated** while signed out. There is exactly
 *    one layout contributor in the repo today, which is what makes the shipped
 *    order safe; nothing recorded that, so nothing would notice a second one.
 * 2. **A plugin quietly dropped.** Its routes stop existing and its slot
 *    contributions stop appearing, with no error anywhere — the sidebar is simply
 *    shorter, and every suite that does not open that page stays green.
 *
 * Both are decisions made in `plugins.ts` and observable from it, so they are
 * pinned here rather than through a browser. What is deliberately *not* asserted
 * is relative order between slot-filling plugins: slots are module-level
 * singletons registered before the first render, so that order is free (measured
 * on a live stack — moving `ContentPlugin` after `I18nPlugin` changes nothing but
 * the order of items within a slot).
 */

/** Every plugin the admin ships, in registration order. */
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
    it('registers exactly the shipped plugin set, in order', () => {
        expect(buildPlugins().map((plugin) => plugin.name)).toEqual(
            EXPECTED_PLUGINS
        );
    });

    it('has exactly one plugin contributing a layout, and it is the shell [shell:I-01]', () => {
        // The gate lives in the shell's layout, and the host takes the first one
        // registered. Two contributors means the loser is decided by registration
        // order — a decision nobody made — and if the loser is the shell, every
        // private route is ungated.
        const contributors = buildPlugins()
            .filter((plugin) => plugin.layout)
            .map((plugin) => plugin.name);

        expect(contributors).toEqual(['shell']);
    });

    it('puts the shell ahead of every plugin contributing a private route', () => {
        // Position only matters relative to the layout: a private route
        // contributed by a plugin registered *before* the shell is still mounted
        // under the shell's layout (the host splits by `public`, not by index),
        // but a plugin registered before it that also carried a layout would win.
        // Keeping the shell second — after identity's public screens and before
        // everything else — is what keeps that impossible to introduce by
        // accident.
        const names = buildPlugins().map((plugin) => plugin.name);
        expect(names.indexOf('shell')).toBeLessThan(
            names.indexOf('workspaces')
        );
    });

    it('gives identity the only public routes, so the sign-in page renders outside the gate [shell:I-03]', () => {
        // A private sign-in page is an infinite redirect; a public page anywhere
        // else is an ungated page.
        const publicOwners = buildPlugins()
            .filter((plugin) => plugin.routes?.some((route) => route.public))
            .map((plugin) => plugin.name);

        expect(publicOwners).toEqual(['identity']);
    });

    it('claims each route path exactly once', () => {
        // React Router matches by rank, not declaration order, so a duplicated
        // path renders an unspecified one of the two. The host warns; this fails.
        const paths = buildPlugins().flatMap((plugin) =>
            (plugin.routes ?? []).map((route) => route.path)
        );

        expect([...new Set(paths)].sort()).toEqual([...paths].sort());
    });

    it('marks only the root route as an exact nav match [shell:I-28]', () => {
        // `end` decides what `SidebarNavButton` matches: with it, only the exact
        // path is current; without it, the path and everything under it. `/` is
        // a prefix of every route in the product, so a Home row that lost `end`
        // announces itself as the current page on all of them — two current rows
        // everywhere, which is worse than none. Any *other* row that gained it
        // stops marking itself current on its own sub-pages.
        //
        // The rule spans plugins, so it can only be asserted here, over the
        // assembled nav. The shell's own contribution is pinned in
        // `packages/shell/admin/src/lib/utils/shellPlugin/index.spec.tsx`.
        const items = buildPlugins()
            .flatMap((plugin) => plugin.slots ?? [])
            .filter((contribution) => contribution.slot === SIDEBAR_NAV_SLOT)
            .flatMap((contribution) => contribution.items as SidebarItem[]);

        expect(items.length).toBeGreaterThan(1);
        expect(items.filter((item) => item.end).map((item) => item.to)).toEqual(
            ['/']
        );
    });

    it('names each plugin once', () => {
        const names = buildPlugins().map((plugin) => plugin.name);
        expect([...new Set(names)]).toEqual(names);
    });
});
