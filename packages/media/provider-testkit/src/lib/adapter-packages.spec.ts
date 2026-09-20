import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The structural half of the adapter contract, asserted across every
 * `packages/media/provider-*` at once — the behavioural half is
 * `describeStorageProvider`, which each adapter runs against a real backend.
 *
 * The rule the split exists for: an application picks **one** backend and must
 * not pay for the other five, so an adapter carries its own vendor SDK and
 * nothing else. A NestJS import inside one — a `@Injectable()` reached for
 * while wiring a client, a `ConfigService` to read a bucket name — would make
 * the framework a dependency of every deployment that chose that backend, and
 * would compile and pass its whole suite on the way in.
 *
 * The check is "every non-relative import is either a node built-in or a
 * package this manifest declares", rather than a denylist of the four names we
 * happen to worry about today. A denylist only bans what someone thought of;
 * this one makes the manifest the statement of what an adapter costs, and the
 * manifests are then checked for the framework directly.
 *
 * **A manifest scan alone is not enough**, and this is the bug that proved it.
 * Every adapter imports `ObjectNotFoundError` as a *value* — the port promises
 * a particular rejection from `get`, not merely some rejection — and it used to
 * come from `@orthacms/media-server`, whose root barrel re-exports
 * `MediaModule`. So `provider-local/src/index.ts` → `@orthacms/media-server` →
 * `lib/utils/media-plugin` → `../media.module` → `@nestjs/common`: an adapter
 * that declared no framework and imported no framework loaded one anyway, and
 * `npm i @orthacms/media-provider-s3` installed NestJS, Drizzle, Express and
 * Sharp. The port now lives in `@orthacms/media-domain`, which declares no
 * dependencies at all.
 *
 * `the require graph` below is what keeps that true. It walks every import out
 * of an adapter's entry point, through the workspace packages it reaches, and
 * fails if a forbidden package appears anywhere in the closure — one hop or
 * five. A denylist of direct imports only bans what someone thought of; this
 * bans it however far away it is.
 */
describe('the storage adapter packages', () => {
    /** `packages/media` — this package's own grandparent. */
    const GROUP = join(__dirname, '../../..');

    type Adapter = {
        name: string;
        manifest: { name: string } & Record<string, Record<string, string>>;
        /** Absolute paths of every `.ts` file under `src/`. */
        sources: string[];
    };

    const sourcesOf = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return sourcesOf(path);
            return entry.name.endsWith('.ts') ? [path] : [];
        });

    const ADAPTERS: Adapter[] = readdirSync(GROUP)
        .filter(
            (name) =>
                name.startsWith('provider-') &&
                statSync(join(GROUP, name)).isDirectory()
        )
        .sort()
        .map((name) => ({
            name,
            manifest: JSON.parse(
                readFileSync(join(GROUP, name, 'package.json'), 'utf8')
            ),
            sources: sourcesOf(join(GROUP, name, 'src'))
        }));

    /** Every module specifier a file imports or re-exports from. */
    const specifiersOf = (path: string): string[] =>
        [...readFileSync(path, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(
            (match) => match[1]
        );

    /** The first path segment of a bare specifier: its package name. */
    const packageOf = (specifier: string): string => {
        const parts = specifier.split('/');
        return specifier.startsWith('@')
            ? parts.slice(0, 2).join('/')
            : parts[0];
    };

    const BUILTIN = new Set(builtinModules);
    const isBuiltin = (specifier: string) =>
        BUILTIN.has(specifier.replace(/^node:/, '').split('/')[0]);

    /** What no adapter may reach for, however it is declared. */
    const FORBIDDEN = (name: string) =>
        name.startsWith('@nestjs/') ||
        name === 'react' ||
        name === 'react-dom' ||
        name === 'drizzle-orm' ||
        name === 'class-validator' ||
        name === 'express' ||
        name === '@orthacms/database';

    it('found every adapter package', () => {
        // A wrong path, or a rename, would leave `it.each` iterating an empty
        // list — every case below would pass having read nothing.
        expect(ADAPTERS.map((one) => one.name)).toEqual([
            'provider-azure',
            'provider-gcs',
            'provider-local',
            'provider-memory',
            'provider-s3',
            'provider-testkit',
            'provider-vercel-blob'
        ]);
        for (const adapter of ADAPTERS) {
            expect(adapter.sources.length).toBeGreaterThan(0);
        }
    });

    // covers: media:I-34
    it.each(ADAPTERS.map((a) => [a.name, a] as const))(
        '%s declares no framework',
        (_name, adapter) => {
            const declared = [
                ...Object.keys(adapter.manifest.dependencies ?? {}),
                ...Object.keys(adapter.manifest.devDependencies ?? {}),
                ...Object.keys(adapter.manifest.peerDependencies ?? {})
            ];

            expect(declared.filter(FORBIDDEN)).toEqual([]);
        }
    );

    // covers: media:I-34
    it.each(ADAPTERS.map((a) => [a.name, a] as const))(
        '%s imports nothing it does not declare',
        (_name, adapter) => {
            const declared = new Set([
                ...Object.keys(adapter.manifest.dependencies ?? {}),
                ...Object.keys(adapter.manifest.devDependencies ?? {}),
                ...Object.keys(adapter.manifest.peerDependencies ?? {})
            ]);

            const undeclared = adapter.sources.flatMap((path) =>
                specifiersOf(path)
                    .filter((spec) => !spec.startsWith('.'))
                    .filter((spec) => !isBuiltin(spec))
                    .filter((spec) => !declared.has(packageOf(spec)))
                    .map((spec) => `${path.split('/src/')[1]}: ${spec}`)
            );

            expect(undeclared).toEqual([]);
        }
    );

    // covers: media:I-34
    it.each(ADAPTERS.map((a) => [a.name, a] as const))(
        '%s reaches for one Ortha package — the port, and nothing else',
        (_name, adapter) => {
            // The testkit is the exception the manifests already record: an
            // adapter keeps it in `devDependencies` to run the shared contract
            // suite, so it never travels with the shipped package.
            const ortha = adapter.sources.flatMap((path) =>
                specifiersOf(path)
                    .map(packageOf)
                    .filter((name) => name.startsWith('@orthacms/'))
                    .filter(
                        (name) => name !== '@orthacms/media-provider-testkit'
                    )
            );

            expect([...new Set(ortha)]).toEqual(['@orthacms/media-domain']);
        }
    );

    /* ------------------------------------------------------ the require graph */

    /** `packages/` — the workspace's package root. */
    const PACKAGES = join(GROUP, '..');

    /** Every `@orthacms/*` package in the workspace, name → directory. */
    const WORKSPACE_PACKAGES: Map<string, string> = (() => {
        const found = new Map<string, string>();
        const consider = (dir: string) => {
            const manifestPath = join(dir, 'package.json');
            if (!existsSync(manifestPath)) return;
            const { name } = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (typeof name === 'string') found.set(name, dir);
        };
        for (const entry of readdirSync(PACKAGES)) {
            const dir = join(PACKAGES, entry);
            if (!statSync(dir).isDirectory()) continue;
            consider(dir);
            for (const nested of readdirSync(dir)) {
                const nestedDir = join(dir, nested);
                if (statSync(nestedDir).isDirectory()) consider(nestedDir);
            }
        }
        return found;
    })();

    /** The `.ts` file a specifier names, or `undefined` if it names none. */
    const fileFor = (candidate: string): string | undefined => {
        for (const path of [
            candidate,
            `${candidate}.ts`,
            join(candidate, 'index.ts')
        ]) {
            if (existsSync(path) && statSync(path).isFile()) return path;
        }
        return undefined;
    };

    /**
     * Everything reachable from one entry file: the workspace sources visited,
     * and the bare package names the walk stopped at.
     *
     * It follows relative imports and workspace packages, and stops at anything
     * from `node_modules` — a third party's own graph is its business; what
     * matters is that we asked for it.
     */
    const reachableFrom = (entry: string) => {
        const visited = new Set<string>();
        const externals = new Set<string>();
        const queue = [entry];

        while (queue.length > 0) {
            const file = queue.pop() as string;
            if (visited.has(file)) continue;
            visited.add(file);

            for (const specifier of specifiersOf(file)) {
                if (specifier.startsWith('.')) {
                    const target = fileFor(join(file, '..', specifier));
                    if (target) queue.push(target);
                    continue;
                }

                const name = packageOf(specifier);
                externals.add(name);

                if (isBuiltin(specifier)) continue;

                const dir = WORKSPACE_PACKAGES.get(name);
                if (!dir) continue;
                // Every workspace package resolves from source and points its
                // entry at `src/index.ts` (AGENTS.md, "How packages resolve"),
                // so this is the file a consumer's `require` would reach.
                const target = fileFor(join(dir, 'src', 'index.ts'));
                if (target) queue.push(target);
            }
        }

        return { visited, externals };
    };

    /**
     * The control that makes the cases below mean something.
     *
     * A walk that resolved nothing — a wrong root, a rename, an `exports` shape
     * it cannot follow — would report an empty set of externals and pass every
     * assertion having read one file. So walk the graph that *is* known to
     * reach NestJS, by the exact route the adapters used to take, and require
     * that it does.
     */
    it('sees a framework that is really there', () => {
        const { visited, externals } = reachableFrom(
            join(GROUP, 'server', 'src', 'index.ts')
        );

        expect(visited.size).toBeGreaterThan(20);
        expect([...externals].filter(FORBIDDEN).sort()).toContain(
            '@nestjs/common'
        );
        // The hop that made this invisible to a manifest scan: the barrel that
        // re-exports `MediaModule`.
        expect(
            [...visited].some((path) => path.endsWith('lib/media.module.ts'))
        ).toBe(true);
    });

    // covers: media:I-34
    it.each(ADAPTERS.map((a) => [a.name, a] as const))(
        '%s reaches no framework, however many hops away',
        (_name, adapter) => {
            const entry = fileFor(
                join(GROUP, adapter.name, 'src', 'index.ts')
            ) as string;
            expect(entry).toBeDefined();

            const { visited, externals } = reachableFrom(entry);

            // The walk left the adapter: it followed the port into
            // `@orthacms/media-domain` and read the port's own sources.
            expect(
                [...visited].some((path) =>
                    path.includes(join('media', 'domain', 'src'))
                )
            ).toBe(true);

            expect([...externals].filter(FORBIDDEN).sort()).toEqual([]);
        }
    );

    // covers: media:I-34
    it.each(ADAPTERS.map((a) => [a.name, a] as const))(
        '%s pulls in one Ortha package transitively — the port, and what it needs',
        (_name, adapter) => {
            const entry = fileFor(
                join(GROUP, adapter.name, 'src', 'index.ts')
            ) as string;

            const ortha = [...reachableFrom(entry).externals]
                .filter((name) => name.startsWith('@orthacms/'))
                .filter((name) => name !== '@orthacms/media-provider-testkit')
                .sort();

            // Not "no Ortha package but the port": "no Ortha package the port
            // does not itself pull in". `@orthacms/media-domain` declares no
            // dependencies (asserted in its own `package-manifest.spec.ts`), so
            // today those are the same list — and if the port ever grows one,
            // this fails here rather than in someone's install.
            expect(ortha).toEqual(['@orthacms/media-domain']);
        }
    );
});
