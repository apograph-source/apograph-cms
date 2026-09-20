import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The seam [ADR-0004](../../../../../docs/adr/0004-model-agnostic-copilot-provider.md)
 * exists to hold: **one** package may know a vendor SDK exists.
 *
 * Everything else in `packages/copilot` talks to the `ModelProvider` port, and
 * the reason is load-bearing rather than tidy — a Bedrock or Vertex adapter is
 * supposed to be a new package plus a line in the composition root, and one
 * `import` of a vendor type in the engine, the config or a DTO makes that a
 * refactor instead. It is also the kind of edge that is crossed by autocomplete
 * and never noticed in review, which is why it is checked mechanically.
 *
 * This package is the far end of the same rule: framework-free means it has no
 * dependencies at all, so the block is absent rather than empty.
 */

/** `packages/copilot`, from this spec's own location. */
const GROUP = join(__dirname, '..', '..', '..');

/** The one package allowed to know a vendor exists, and the SDK it knows. */
const ADAPTER = 'provider-anthropic';
const ITS_SDK = '@anthropic-ai/sdk';

/**
 * Model-vendor SDKs by name. A list of names cannot be exhaustive, which is why
 * the two provider packages are additionally pinned to *no* third-party imports
 * at all below — that half catches the SDK nobody thought to add here.
 */
const VENDOR_SDKS = [
    '@anthropic-ai/sdk',
    'openai',
    '@azure/openai',
    '@google/genai',
    '@google/generative-ai',
    '@mistralai/mistralai',
    'cohere-ai',
    '@aws-sdk/client-bedrock-runtime',
    'groq-sdk',
    'ollama',
    'replicate',
    'ai',
    'langchain',
    '@langchain/core'
];

/** The packages in the group, by directory name. */
const packages = readdirSync(GROUP).filter((entry) =>
    statSync(join(GROUP, entry)).isDirectory()
);

/** One package's manifest. */
const manifest = (pkg: string) =>
    JSON.parse(readFileSync(join(GROUP, pkg, 'package.json'), 'utf8')) as {
        private?: boolean;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };

/** The workspace's `nx.json`, four levels up from `packages/copilot`. */
const nxJson = () =>
    JSON.parse(readFileSync(join(GROUP, '..', '..', 'nx.json'), 'utf8')) as {
        release: { projects: string[] };
    };

/**
 * Every shipped `.ts`/`.tsx` file under a package's `src`.
 *
 * Specs are excluded because they are not the package: this file itself reads
 * the filesystem, and a test double is allowed to import whatever it needs to
 * stand in for. The rule is about what the *code* knows.
 */
function sources(pkg: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (
                /\.tsx?$/.test(entry.name) &&
                !/\.(spec|test)\.tsx?$/.test(entry.name)
            ) {
                out.push(path);
            }
        }
    };
    walk(join(GROUP, pkg, 'src'));
    return out;
}

/** The module specifiers one file imports from outside itself. */
function externalImports(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const specifiers = [
        ...source.matchAll(
            /^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm
        ),
        ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
    ].map((match) => match[1]);
    return specifiers.filter((specifier) => !specifier.startsWith('.'));
}

/** The npm package a specifier belongs to (`@scope/name`, or `name`). */
const packageOf = (specifier: string) =>
    specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];

describe('the vendor SDK boundary', () => {
    it('is crossed by provider-anthropic and nothing else [copilot:I-36]', () => {
        const importers: Record<string, string[]> = {};
        for (const pkg of packages) {
            for (const file of sources(pkg)) {
                const vendors = externalImports(file)
                    .map(packageOf)
                    .filter((name) => VENDOR_SDKS.includes(name));
                if (vendors.length > 0) {
                    importers[pkg] = [
                        ...new Set([...(importers[pkg] ?? []), ...vendors])
                    ];
                }
            }
        }

        expect(importers).toEqual({ [ADAPTER]: [ITS_SDK] });
    });

    it('is declared by provider-anthropic and nothing else [copilot:I-36]', () => {
        const declared: Record<string, string[]> = {};
        for (const pkg of packages) {
            const json = manifest(pkg);
            const names = Object.keys({
                ...json.dependencies,
                ...json.devDependencies,
                ...json.peerDependencies
            }).filter((name) => VENDOR_SDKS.includes(name));
            if (names.length > 0) {
                declared[pkg] = names;
            }
        }

        expect(declared).toEqual({ [ADAPTER]: [ITS_SDK] });
    });

    /**
     * The half a name list cannot cover. Both of these adapters speak their
     * wire format by hand — provider-openai parses the SSE itself — so "no
     * third-party import at all" is a claim their code can actually make, and
     * it fails on an SDK this file has never heard of.
     */
    it.each(['provider-openai', 'provider-fake'])(
        '%s speaks its wire format with no third-party package [copilot:I-36]',
        (pkg) => {
            const external = new Set(
                sources(pkg)
                    .flatMap(externalImports)
                    .map(packageOf)
                    .filter((name) => !name.startsWith('node:'))
            );

            expect([...external]).toEqual(['@orthacms/copilot-domain']);
        }
    );

    it('leaves copilot-domain with no dependencies block at all [copilot:I-36]', () => {
        const json = manifest('domain');

        // Absent, not empty: a `{}` is a place for the first one to be added
        // without anyone reading the diff twice.
        expect(json.dependencies).toBeUndefined();
        expect(json.peerDependencies).toBeUndefined();
        // And nothing it imports could need one — the port, the profile and the
        // proposal contracts are framework-free by the same rule.
        expect(sources('domain').flatMap(externalImports)).toEqual([]);
    });
});

/**
 * `provider-fake` is scripted and deterministic, and the reason it is a private
 * test fixture rather than a shipped adapter is a safety property: a deployment
 * that configured no backend must have *no* copilot, not one answering from a
 * canned script. Two things keep it that way, and neither is visible from the
 * package's own code — so both are asserted here, beside the manifest rules
 * they belong with.
 */
describe('the private test fixture', () => {
    it('is published nowhere [copilot:I-37]', () => {
        expect(manifest('provider-fake').private).toBe(true);
        // `private` alone is not enough: the release runs over an
        // `@orthacms/*` glob, so the exclusion has to be written out.
        expect(nxJson().release.projects).toContain(
            '!@orthacms/copilot-provider-fake'
        );
    });
});
