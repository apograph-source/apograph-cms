import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `ToolContext.surface` may change how a response reads, never what it means.
 *
 * The rule is stated as a universal over every tool handler in the workspace —
 * "never a check, a filter, or a disclosed field keyed on surface" — and a
 * judgment once retired it as unenforceable for that reason: a test can sample
 * individual tools, and sampling is not a universal.
 *
 * What makes it enforceable is that a handler can only learn its surface one
 * way. The registry stamps `ToolContext.surface` at dispatch and there is no
 * other channel, so the scan below does not need to understand what a handler
 * *does* with the field — it only has to enumerate who can see it at all. Today
 * that is one provider, for one reason, and the assertion is the list.
 *
 * A new provider that reads `surface` fails here. That is the point: it is not
 * a claim that reading the field is wrong, it is a claim that doing so is a
 * decision somebody has to write down. The companion assertion lives in
 * `packages/media/server/src/lib/copilot/media-tool.provider.spec.ts`, which
 * pins that the one existing reader varies a link and not the field set.
 */

/** The workspace's `packages/` directory. */
const PACKAGES = join(__dirname, '..', '..', '..');

/**
 * The one file allowed to read the surface, and why.
 *
 * `media_assets_search` and `media_asset_read` return a `downloadPath`. The
 * copilot's caller is a signed-in browser and gets the session route; an MCP
 * caller holds a bearer token and gets the `/v1` route the token can actually
 * fetch. Same assets, same workspace scope, same `media:read` — a different
 * URL for the same bytes.
 */
const PRESENTATION_READERS = new Set([
    'media/server/src/lib/copilot/media-tool.provider.ts'
]);

/** Every non-spec TypeScript source under `packages/`. */
function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules' || entry.name === 'dist') return [];
        if (entry.name === 'out-tsc' || entry.name.startsWith('.')) return [];
        const path = join(dir, entry.name);
        if (statSync(path).isDirectory()) return sources(path);
        if (!/\.ts$/.test(entry.name)) return [];
        if (/\.spec\.ts$/.test(entry.name)) return [];
        return [path];
    });
}

describe('surface is presentation, never authority', () => {
    /** Every file that supplies tools to the shared registry. */
    const providers = sources(PACKAGES).filter((path) =>
        /implements[^{]*\bToolProvider\b/.test(readFileSync(path, 'utf-8'))
    );

    it('finds the provider set it is scanning', () => {
        // The premise. A scan that matched nothing would pass every assertion
        // below without looking at a line of anybody's handler — the shape of a
        // test that cannot fail.
        expect(providers.length).toBeGreaterThan(8);
        expect(providers.map((path) => relative(PACKAGES, path))).toContain(
            'media/server/src/lib/copilot/media-tool.provider.ts'
        );
    });

    it('is read by exactly the handlers that render a link [tools:I-09]', () => {
        // A handler learns its surface only from the context the registry
        // stamps, so `.surface` is the whole attack surface of this rule. An
        // `if (ctx.surface === 'copilot')` around a permission check, a filter,
        // or an extra field lands here, whichever of the three it is.
        const readers = providers
            .filter((path) => /\.surface\b/.test(readFileSync(path, 'utf-8')))
            .map((path) => relative(PACKAGES, path));

        expect(new Set(readers)).toEqual(PRESENTATION_READERS);
    });
});
