import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The two claims about the shared kernel that are made of **absences** — no
 * dependencies, and no second copy of the rules — and are therefore invisible
 * to every test that calls it.
 *
 * Both are load-bearing for the same reason. This is the single sanctioned
 * FE↔BE code share (ADR-0003 #7): a dependency added here is inherited by the
 * NestJS server *and* by the browser bundle, and a rule re-implemented on
 * either side is a drift nobody sees until the admin lets a value through that
 * the server then refuses — or, worse, disables Publish on an entry that would
 * have published.
 *
 * `validate-entry-values.spec.ts` and `publish-gate.spec.ts` next door pin what
 * the rules *do*. Nothing pins that they are the only ones.
 */

/** The repository root, from `packages/content/domain/src/lib`. */
const REPO = join(__dirname, '../../../../..');

/** The kernel's own sources. */
const KERNEL_SRC = join(__dirname, '..');

/** Directory names a source walk never descends into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out-tsc', 'test-output']);

/** Every non-spec TypeScript file under `root`, recursively. */
function sourceFiles(root: string): string[] {
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
                /\.tsx?$/.test(entry.name) &&
                !/\.spec\.tsx?$/.test(entry.name)
            ) {
                out.push(path);
            }
        }
    };
    walk(root);
    return out;
}

/** The module specifiers a file imports or re-exports from. */
function specifiersOf(path: string): string[] {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

describe('@orthacms/content-domain has no dependencies [content:I-37]', () => {
    const manifest = JSON.parse(
        readFileSync(join(KERNEL_SRC, '../package.json'), 'utf8')
    ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };

    it('is the package it claims to be', () => {
        expect(manifest.name).toBe('@orthacms/content-domain');
    });

    it.each(['dependencies', 'peerDependencies'] as const)(
        'declares no %s',
        (field) => {
            expect(Object.keys(manifest[field] ?? {})).toEqual([]);
        }
    );

    const FILES = sourceFiles(KERNEL_SRC);

    it('found the kernel sources to check', () => {
        // A walk that matched nothing would make the check below vacuous.
        expect(FILES.length).toBeGreaterThan(10);
        expect(
            FILES.some((path) => path.endsWith('validate-entry-values.ts'))
        ).toBe(true);
        expect(FILES.some((path) => path.endsWith('publish-gate.ts'))).toBe(
            true
        );
    });

    it('imports nothing but itself — not even a node built-in', () => {
        // Stricter than the manifest, and it has to be: a `node:crypto` or a
        // `react` import would compile, pass every rule test, and break the
        // browser bundle or a future non-node runtime without adding a line to
        // package.json. `countCharacters` uses `Intl.Segmenter`, which is a
        // platform global rather than an import, which is exactly why it was
        // chosen over a grapheme-splitting library.
        const external = FILES.flatMap((path) =>
            specifiersOf(path)
                .filter((spec) => !spec.startsWith('.'))
                .map((spec) => `${relative(REPO, path)} → ${spec}`)
        );
        expect(external).toEqual([]);
    });
});

describe('the rules exist in one copy [content:I-38]', () => {
    /** Every production source in the repository, tests excluded. */
    const REPO_CODE = [
        ...sourceFiles(join(REPO, 'packages')),
        ...sourceFiles(join(REPO, 'apps'))
    ].map((path) => ({
        file: relative(REPO, path),
        source: readFileSync(path, 'utf8')
    }));

    it('read the repository at all', () => {
        expect(REPO_CODE.length).toBeGreaterThan(1500);
    });

    it.each(['validateFieldValue', 'canPublish'])(
        '%s is defined only in the kernel',
        (name) => {
            // The field rules and the publish predicate. A second definition —
            // "just this one check, client-side, so the button is instant" — is
            // how the admin and the server start disagreeing about what a valid
            // value is.
            const definers = REPO_CODE.filter(({ source }) =>
                new RegExp(`function ${name}\\s*\\(`).test(source)
            ).map(({ file }) => file);

            expect(definers).toEqual([
                `packages/content/domain/src/lib/validation/${
                    name === 'canPublish'
                        ? 'publish-gate'
                        : 'validate-entry-values'
                }.ts`
            ]);
        }
    );

    it.each([
        [
            "the server's validation authority",
            'packages/content/server/src/lib/validation/services/entry-validation.service.ts'
        ],
        [
            "the admin's field errors",
            'packages/content/admin/src/lib/presentation/entryValidation/index.ts'
        ],
        [
            "the admin's publish flow",
            'packages/content/admin/src/lib/application/usePublishEntryFlow/index.ts'
        ]
    ])('%s runs the kernel rather than its own rules', (_label, file) => {
        // The complement. "Defined once" would also hold of a kernel nobody
        // called: what makes it the single copy is that both runtimes' own
        // validation modules are wrappers around it.
        const entry = REPO_CODE.find((hit) => hit.file === file);
        expect(entry).toBeDefined();
        expect(specifiersOf(join(REPO, file))).toContain(
            '@orthacms/content-domain'
        );
    });
});
