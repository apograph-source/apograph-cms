import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collection, single } from '../collection/define';
import { field } from '../fields';
import { ContentTypeRegistry } from '../registry/content-type-registry';

/**
 * "Content types are declared in code only" is a claim made of an **absence**,
 * and nothing that drives the running server can see it. `content-types.spec.ts`
 * pins that the served catalogue is the code-defined registry — which would go
 * on passing byte for byte the day somebody added `POST /content-schema`, since
 * a type created through it would be in the registry too and therefore in the
 * catalogue. The observable for an absent route is the source tree and the
 * registry's own surface, so this reads both.
 *
 * Two halves, and both are needed:
 *
 * - **No write route over the catalogue.** Every route the content packages
 *   serve under the two type-catalogue prefixes is a `GET`.
 * - **Nothing to call if there were one.** The registry is built once, from the
 *   list `ContentPlugin` was handed, and exposes no method that adds, changes or
 *   removes a type — so a handler holding it via `@InjectContentRegistry()` has
 *   no operation to reach for. Without this half the first check would only be
 *   about URL spellings: a `PATCH /content/:typeName` that mutated the registry
 *   would satisfy it.
 */

/** The repository root, from `packages/content/server/src/lib/content-types`. */
const REPO = join(__dirname, '../../../../../..');

/** Every content package that serves HTTP. */
const HTTP_PACKAGES = [
    join(REPO, 'packages/content/server/src'),
    join(REPO, 'packages/content/graphql/src')
];

/** Directory names a source walk never descends into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out-tsc', 'test-output']);

/** Every `*.controller.ts` under `root`, recursively. */
function controllerFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
                continue;
            }
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (
                entry.name.endsWith('.controller.ts') &&
                !entry.name.endsWith('.spec.ts')
            ) {
                out.push(path);
            }
        }
    };
    walk(root);
    return out;
}

/** One route: the controller's prefix, the HTTP verb, and where it is declared. */
interface Route {
    prefix: string;
    verb: string;
    path: string;
    at: string;
}

const VERBS = [
    'Get',
    'Post',
    'Put',
    'Patch',
    'Delete',
    'All',
    'Head',
    'Options'
];

/** Every route declared by `file`, read off its decorators. */
function routesOf(file: string): Route[] {
    const source = readFileSync(file, 'utf8');
    const prefix =
        /@Controller\(\s*'([^']*)'/.exec(source)?.[1] ??
        (/@Controller\(\s*\)/.test(source) ? '' : undefined);
    if (prefix === undefined) return [];

    const routes: Route[] = [];
    for (const [index, line] of source.split('\n').entries()) {
        const match = new RegExp(
            `^\\s*@(${VERBS.join('|')})\\(\\s*(?:'([^']*)')?`
        ).exec(line);
        if (!match) continue;
        routes.push({
            prefix,
            verb: match[1].toUpperCase(),
            path: match[2] ?? '',
            at: `${relative(REPO, file)}:${index + 1}`
        });
    }
    return routes;
}

describe('content types are declared in code, not over HTTP', () => {
    const ROUTES = HTTP_PACKAGES.flatMap(controllerFiles).flatMap(routesOf);

    /**
     * The two URL prefixes that serve the type catalogue: the admin's schema
     * routes and the public API's. Everything under either describes the
     * content *model*; everything else addresses entries, revisions, views or
     * insights, which are data.
     */
    const CATALOGUE = ROUTES.filter(
        (route) =>
            route.prefix === 'content-schema' ||
            route.prefix === 'v1/content-types'
    );

    it('read the controllers at all', () => {
        // The guard on the guard: a walk that matched nothing, or a decorator
        // spelling this parser no longer recognises, would make both checks
        // below pass without reading a route.
        expect(ROUTES.length).toBeGreaterThan(40);
        expect(CATALOGUE.length).toBeGreaterThanOrEqual(4);
        // And the scan must be seeing writes somewhere, or "no write route"
        // would be a statement about the parser rather than about the routes.
        expect(ROUTES.some((route) => route.verb !== 'GET')).toBe(true);
    });

    it('serves the catalogue read-only [content:I-01]', () => {
        const writes = CATALOGUE.filter((route) => route.verb !== 'GET');
        expect(writes.map((route) => `${route.verb} ${route.at}`)).toEqual([]);
    });

    describe('and the registry has nothing a route could call [content:I-01]', () => {
        const author = collection('author', {
            fields: { name: field.text() }
        });
        const home = single('home', {
            path: '/',
            fields: { headline: field.text() }
        });

        it('exposes only readers', () => {
            // An exact list, not a "does not contain register" scan: the point
            // is that a *new* method has to be argued for here, whatever it is
            // called. `define`, `addField` and `remove` are the obvious three,
            // and the ones nobody would name that way are the risk.
            const surface = Object.getOwnPropertyNames(
                ContentTypeRegistry.prototype
            );

            expect(surface.sort()).toEqual([
                'all',
                'constructor',
                'get',
                'serialize',
                'serializeAll',
                'serializeField',
                'serializeType',
                'summaries',
                'summaryOf'
            ]);
        });

        it('hands out a copy of its types, not the list itself', () => {
            // `all()` is what a handler holding the registry would reach for.
            // Returning `this.byName.values()`' backing array — or the array
            // passed to the constructor — would make `registry.all().push(…)`
            // a working, unreviewed content-type-creation API.
            const registry = new ContentTypeRegistry([author, home]);

            registry
                .all()
                .push(
                    collection('smuggled', { fields: { name: field.text() } })
                );

            expect(registry.all().map((type) => type.name)).toEqual([
                'author',
                'home'
            ]);
            expect(registry.get('smuggled')).toBeUndefined();
        });

        it('is built once, from the list the host declared', () => {
            // The complement of "no mutator": a second construction site is the
            // other way the set of types could change after boot. The plugin
            // factory is the only production one — the fixture builder in the
            // GraphQL package's tests is a test.
            const sites: string[] = [];
            const walk = (dir: string) => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                        continue;
                    const path = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(path);
                    } else if (
                        /\.tsx?$/.test(entry.name) &&
                        !/\.spec\.tsx?$/.test(entry.name) &&
                        !path.includes('__test__') &&
                        readFileSync(path, 'utf8').includes(
                            'new ContentTypeRegistry('
                        )
                    ) {
                        sites.push(relative(REPO, path));
                    }
                }
            };
            for (const root of [join(REPO, 'packages'), join(REPO, 'apps')]) {
                walk(root);
            }

            expect(sites.sort()).toEqual([
                'packages/content/server/src/lib/utils/content-plugin.ts'
            ]);
        });
    });
});
