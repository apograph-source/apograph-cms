import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * What the server host is allowed to know about.
 *
 * These are claims about the package's *shape* rather than its behaviour, so
 * nothing a request can do will ever fail on them — and they are exactly the
 * kind that decays quietly, because adding the import that breaks one is always
 * the convenient move in the moment.
 */

const PACKAGE_ROOT = join(__dirname, '..');

/** Every TypeScript source file in the package, specs excluded. */
function sourceFiles(dir = join(PACKAGE_ROOT, 'src')): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) return [];
        return [path];
    });
}

describe('the server host’s dependencies', () => {
    it('does not depend on express, and names its request types structurally [bootstrap:I-36]', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as Record<string, Record<string, string> | undefined>;

        const declared = Object.keys({
            ...manifest['dependencies'],
            ...manifest['peerDependencies'],
            ...manifest['devDependencies']
        });
        // Express is reached only through `@nestjs/platform-express`. Declaring
        // it here — or, worse, importing it without declaring it — makes it a
        // phantom dependency: resolvable in this workspace because npm hoists
        // it to the root, absent from a consumer's tree, and refused at publish
        // time by `pack.mjs`'s `verifyDependenciesAreDeclared`.
        expect(declared).not.toContain('express');
        expect(declared).not.toContain('@types/express');

        // `serve-admin.ts` declares the two-method slices of express's request
        // and response it touches (`StaticRequest` / `StaticResponse`) rather
        // than importing the types. This is the assertion that fails the moment
        // someone reaches for `import type { Request } from 'express'` because
        // the structural interface was one property short.
        const importsExpress = sourceFiles().filter((file) =>
            /(from|require\()\s*['"]express['"]/.test(
                readFileSync(file, 'utf8')
            )
        );
        expect(importsExpress).toEqual([]);
    });
});

/**
 * "The hosts contain no domain logic: no guards, no tables, no API routes, no
 * screens."
 *
 * A judgment once retired this whole invariant as unreachable, on the grounds
 * that a grep for decorators "would pass on a host that had grown domain logic
 * under a different shape". That objection is right about the *second*
 * sentence — "adding a capability never requires editing a file in
 * packages/bootstrap" is a claim about future diffs, and stays uncovered — and
 * wrong about the first, which is not a vague statement about domain logic: it
 * is a list of four concrete shapes, and in this codebase each has exactly one
 * spelling.
 *
 * A guard is a `CanActivate`. An API route is a `@Controller` with Nest method
 * decorators — the reference routes are registered on the http adapter and
 * deliberately are not these. A table is a Drizzle `pgTable`. And all three
 * would arrive with a dependency the manifest does not declare, which is the
 * assertion that does not depend on spelling at all.
 */
describe('the server host holds no domain logic', () => {
    /** Source files whose text matches, relative to the package. */
    const matching = (pattern: RegExp): string[] =>
        sourceFiles()
            .filter((file) => pattern.test(readFileSync(file, 'utf8')))
            .map((file) => relative(PACKAGE_ROOT, file));

    it('defines no guard, no controller and no table [bootstrap:I-01]', () => {
        // A guard. The host applies global policy — a prefix, a pipe, a body
        // cap — and every *decision about a caller* belongs to a plugin.
        expect(matching(/\bCanActivate\b/)).toEqual([]);
        // An API route. `/reference` and `/reference/json` go on the http
        // adapter precisely so they sit outside the prefix and the guards, so
        // a `@Controller` here would be the first routed endpoint the host
        // owned.
        expect(
            matching(/@Controller\b|@(Get|Post|Put|Patch|Delete)\s*\(/)
        ).toEqual([]);
        // A table. The one sanctioned host-adjacent table (`outbox_events`)
        // belongs to `@orthacms/database`, which is a plugin like any other.
        expect(matching(/\bpgTable\b|drizzle-orm/)).toEqual([]);
    });

    it('declares no dependency that could carry one [bootstrap:I-01]', () => {
        // The assertion that survives a different spelling. A guard needs a
        // permission vocabulary, a table needs Drizzle and a connection — and
        // none of the three is reachable without a dependency this manifest
        // would have to grow first.
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as Record<string, Record<string, string> | undefined>;
        const declared = Object.keys({
            ...manifest['dependencies'],
            ...manifest['peerDependencies'],
            ...manifest['devDependencies']
        });

        expect(declared).not.toContain('drizzle-orm');
        expect(
            declared.filter((name) => name.startsWith('@orthacms/'))
        ).toEqual([]);
        // …and not through an undeclared import either, which is how a phantom
        // dependency gets in (see the express case above).
        expect(matching(/from '@ortha\//)).toEqual([]);
    });
});
