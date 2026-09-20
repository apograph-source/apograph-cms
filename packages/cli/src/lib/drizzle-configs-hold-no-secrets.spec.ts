import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The corollary half of `cli:I-20`.
 *
 * "generate never connects to a database" is pinned twice already —
 * `commands.spec.ts` shows `generateCommand` calls neither `loadHost` nor
 * `requireDatabaseUrl` and hands drizzle-kit an argv with no URL in it, and
 * `generate.spec.ts` shows the `execFileSync` options are exactly `{cwd,
 * stdio}` so nothing is injected through the environment either.
 *
 * The clause nothing reached is the one the invariant states as the *reason*:
 * "which is why there are — and must be — no secrets in the drizzle configs".
 * That is not an unbounded absence. The configs are a dozen committed files, so
 * it is a scan, and this is it.
 *
 * It matters because the pressure to add `dbCredentials` is real and arrives
 * from drizzle-kit itself: `drizzle-kit push`, `pull` and `studio` all demand
 * one, and a developer reaching for any of them will be told to put a URL in
 * the config that `generate` shares. The moment one appears, either a
 * connection string is committed or generation starts depending on a live
 * database — and every assertion about the spawned argv stays green, because
 * the secret came in through the config file drizzle-kit reads for itself.
 */

/** The monorepo root — the nearest ancestor holding `nx.json`. */
function workspaceRoot(): string | undefined {
    let dir = __dirname;

    for (;;) {
        if (existsSync(join(dir, 'nx.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** Every committed `drizzle.config.ts`, `node_modules` and build output aside. */
function drizzleConfigs(root: string, dir = root): string[] {
    return readdirSync(dir).flatMap((entry) => {
        if (/^(node_modules|\.git|dist|out-tsc|tmp|coverage)$/.test(entry))
            return [];

        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return drizzleConfigs(root, path);
        return entry === 'drizzle.config.ts' ? [path] : [];
    });
}

/**
 * What a secret looks like in one of these files: the `dbCredentials` block
 * drizzle-kit reads to connect, a bare connection `url`, or anything reaching
 * into the environment for one. Comments are stripped before this runs — every
 * one of these files *mentions* `dbCredentials` in its doc comment, to say why
 * it has none.
 */
function credentials(source: string): string[] {
    const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    return [
        /\bdbCredentials\b/,
        /\burl\s*:/,
        /\bpassword\s*:/,
        /\bprocess\s*\.\s*env\b/,
        /postgres(?:ql)?:\/\//
    ]
        .filter((pattern) => pattern.test(stripped))
        .map((pattern) => String(pattern));
}

describe('the committed drizzle configs hold no secrets', () => {
    const root = workspaceRoot();

    it('declares no credentials in any generation config [cli:I-20]', () => {
        // Only meaningful inside the monorepo; a published `@orthacms/cli` has
        // no workspace around it to scan.
        if (!root) return;

        const configs = drizzleConfigs(root);

        // Every plugin that owns a schema ships one, plus the two hosts. If the
        // walk found a handful, it walked the wrong tree and the assertion
        // below would pass by finding nothing to look at.
        expect(configs.length).toBeGreaterThanOrEqual(8);

        const offenders = configs.flatMap((path) => {
            const found = credentials(readFileSync(path, 'utf8'));
            return found.length
                ? [`${relative(root, path).split(sep).join('/')}: ${found}`]
                : [];
        });

        expect(offenders).toEqual([]);
    });

    it('would name a config that grew one [cli:I-20]', () => {
        // The detector's own control. Without it, a `credentials()` that had
        // stopped matching anything — a stripped-too-eagerly regex, say — would
        // report a clean workspace forever.
        expect(
            credentials(
                '/** no dbCredentials here */\nexport default defineConfig({\n' +
                    "    dialect: 'postgresql',\n" +
                    '    dbCredentials: { url: process.env.DATABASE_URL! }\n' +
                    '});\n'
            )
        ).not.toEqual([]);

        expect(
            credentials(
                '/** generation only diffs against the snapshot, so no ' +
                    '`dbCredentials` (and no secret) is needed here. */\n' +
                    "export default defineConfig({ dialect: 'postgresql', " +
                    "schema: './src/lib/schema/index.ts', out: './migrations' });\n"
            )
        ).toEqual([]);
    });
});
