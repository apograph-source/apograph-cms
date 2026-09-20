import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { WYSIWYG_PROSE_CLASS } from './domain/constants';
import * as entryPoint from '../index';

/**
 * Structural claims — the ones a browser cannot see.
 *
 * Three of this package's rules are about the shape of the source rather than
 * the behaviour of the app, and each fails **silently**: the lazy boundary
 * shows up only as ~460 kB more in the entry chunk, a `domain/` layer that has
 * started importing TipTap still works, and a style rule that escaped
 * `.ortha-wysiwyg` only shows up on whatever unrelated page it lands on. So
 * they are asserted against the tree itself, the way
 * `packages/identity/domain`'s manifest test asserts its zero-dependency rule.
 */

/** This package's `src` root. */
const SRC = join(__dirname, '..');

/** Every `.ts`/`.tsx` under `dir`, specs excluded. */
function sources(dir: string = SRC): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sources(path);
        if (!/\.tsx?$/.test(entry.name)) return [];
        if (/\.(spec|test)\.tsx?$/.test(entry.name)) return [];
        return [path];
    });
}

/** `file` with comments removed, so a specifier named in prose is not an import. */
function code(file: string): string {
    return readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(?<![:'"\\])\/\/[^\n]*/g, '');
}

type ImportRef = {
    /** The module specifier as written. */
    specifier: string;
    /** `import type …` / `export type …`, which emits nothing at runtime. */
    typeOnly: boolean;
};

/** The `import`/`export … from` specifiers in `file`, dynamic ones excluded. */
function staticImports(file: string): ImportRef[] {
    // A dynamic import is not a static edge, and leaving it in would let the
    // scan run past it to the next `from` and mis-attribute the clause.
    const text = code(file).replace(/\bimport\s*\(/g, '__dynamic__(');
    const refs: ImportRef[] = [];

    for (const match of text.matchAll(
        /\b(import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g
    )) {
        refs.push({
            specifier: match[3],
            typeOnly: /^\s*type\s/.test(match[2])
        });
    }
    // A bare side-effect import (`import './styles.css'`) has no `from`.
    for (const match of text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
        refs.push({ specifier: match[1], typeOnly: false });
    }
    return refs;
}

/** The `import('…')` specifiers in `file` — the lazy edges. */
function dynamicImports(file: string): string[] {
    return [
        ...code(file).matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
    ].map((match) => match[1]);
}

/** A relative specifier resolved to a file in this package, or `null`. */
function resolveLocal(specifier: string, from: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(from), specifier);
    for (const candidate of [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx')
    ]) {
        if (existsSync(candidate)) return candidate;
    }
    // Loud rather than silent: an unresolvable edge means the walk stops early
    // and every "does not reach TipTap" assertion below passes for free.
    throw new Error(`cannot resolve '${specifier}' from ${from}`);
}

type Graph = {
    /** Every file in this package the walk reached, relative to `src`. */
    files: Set<string>;
    /** Every non-relative specifier reached (`react`, `@tiptap/core`, …). */
    packages: Set<string>;
};

/**
 * Walks the import graph from `entry`.
 *
 * `lazy: false` follows only static edges — the ones that decide what lands in
 * the chunk that imports the entry point. `lazy: true` follows `import()` too,
 * which is the whole application and is used here only to prove the walk is
 * capable of finding what the first mode must not find.
 */
function walk(entry: string, { lazy }: { lazy: boolean }): Graph {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [entry];

    while (queue.length) {
        const file = queue.pop() as string;
        const key = relative(SRC, file);
        if (files.has(key)) continue;
        files.add(key);

        const specifiers = [
            ...staticImports(file)
                .filter((ref) => !ref.typeOnly)
                .map((ref) => ref.specifier),
            ...(lazy ? dynamicImports(file) : [])
        ];

        for (const specifier of specifiers) {
            const local = resolveLocal(specifier, file);
            if (local) queue.push(local);
            else packages.add(specifier);
        }
    }
    return { files, packages };
}

/** Every `{ … }` rule in a stylesheet, as its selector prelude. */
function selectors(css: string): string[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    let prelude = '';
    let depth = 0;
    let block = '';

    for (const character of text) {
        if (depth > 0) {
            if (character === '{') depth += 1;
            if (character === '}') {
                depth -= 1;
                if (depth === 0) {
                    // An at-rule wraps ordinary rules; its own prelude is not a
                    // selector, so descend into what it holds.
                    if (prelude.trim().startsWith('@')) {
                        out.push(...selectors(block));
                    } else {
                        out.push(
                            ...prelude
                                .split(',')
                                .map((one) => one.trim())
                                .filter(Boolean)
                        );
                    }
                    prelude = '';
                    block = '';
                    continue;
                }
            }
            block += character;
            continue;
        }
        if (character === '{') {
            depth = 1;
            continue;
        }
        prelude += character;
    }
    return out;
}

/** One top-level CSS rule: what it selects, and what it declares. */
interface DeclarationBlock {
    prelude: string;
    block: string;
}

/**
 * The top-level rules of a stylesheet, comments stripped. Unlike
 * {@link selectors} this keeps the **declarations**, which is what a claim
 * about *how* something is styled has to read.
 */
function declarationBlocks(css: string): DeclarationBlock[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: DeclarationBlock[] = [];

    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const prelude = match[1].trim();
        // An at-rule's prelude is not a selector and its body holds rules
        // rather than declarations; this file has none around the media rules,
        // and skipping them keeps the pairs honest.
        if (prelude.startsWith('@')) continue;
        out.push({ prelude, block: match[2] });
    }
    return out;
}

describe('the lazy boundary', () => {
    const entry = join(SRC, 'index.ts');

    it('pulls no TipTap into whatever imports the plugin [wysiwyg:I-03]', () => {
        // The factory has to run at boot to register its slot contribution, so
        // everything it statically imports is in the app's **entry** chunk —
        // the sign-in page included. TipTap and ProseMirror are ~460 kB of it,
        // for a control that only renders inside an entry editor.
        const { packages } = walk(entry, { lazy: false });

        expect(
            [...packages].filter((name) => /^(@tiptap|prosemirror-)/.test(name))
        ).toEqual([]);
    });

    it('takes both halves of the contribution through import()', () => {
        const { files } = walk(entry, { lazy: false });
        const lazily = walk(entry, { lazy: true });

        const halves = [
            join(
                'lib',
                'presentation',
                'components',
                'WysiwygFieldControl',
                'index.tsx'
            ),
            join(
                'lib',
                'presentation',
                'components',
                'WysiwygFieldFullView',
                'index.tsx'
            )
        ];

        for (const half of halves) {
            // Not in the static graph…
            expect(files.has(half)).toBe(false);
            // …but reachable, so the contribution is complete rather than the
            // static walk having simply lost the thread.
            expect(lazily.files.has(half)).toBe(true);
        }
    });

    it('would notice TipTap if it were there', () => {
        // The guard on the two assertions above. A resolver that silently
        // stopped walking would make "reaches no TipTap" vacuously true; this
        // is the same walk, following the lazy edges, and it must find the
        // editor's schema on the other side of them.
        const { packages } = walk(entry, { lazy: true });

        expect([...packages]).toContain('@tiptap/core');
    });

    it('exports nothing but the plugin and its vocabulary', () => {
        // The runtime view of the same rule: re-exporting the preview or the
        // editor from here would pull TipTap straight back into the entry
        // chunk, however carefully the factory itself avoids it.
        expect(Object.keys(entryPoint).sort()).toEqual([
            'WYSIWYG_MEDIA_KIND',
            'WYSIWYG_MEDIA_KINDS',
            'WYSIWYG_MEDIA_SLOT',
            'WYSIWYG_WIDGET',
            'WysiwygPlugin'
        ]);
    });
});

describe('the layers', () => {
    const inLayer = (layer: string) =>
        sources(join(SRC, 'lib', layer)).map((file) => relative(SRC, file));

    it('keeps every framework out of domain/ [wysiwyg:I-33]', () => {
        // `domain/` is the vocabulary the extensions, the toolbar and the
        // stylesheet all read. A React or TipTap import here is what makes a
        // rule un-reusable and un-testable without an editor — and every rule
        // in this package that has gone wrong went wrong at exactly one writer,
        // which is why they end up here.
        const offenders = inLayer('domain')
            .map((file) => ({
                file,
                bad: staticImports(join(SRC, file))
                    .map((ref) => ref.specifier)
                    // Type-only included on purpose: the claim is about the
                    // layer's vocabulary, not only about its bundle.
                    .filter((specifier) =>
                        /^(react|react-dom|react-intl|@tiptap\/)/.test(
                            specifier
                        )
                    )
            }))
            .filter((entry) => entry.bad.length > 0);

        expect(offenders).toEqual([]);
        // Not vacuous: there are files in the layer to be wrong.
        expect(inLayer('domain').length).toBeGreaterThanOrEqual(4);
    });

    it('never imports upward from infrastructure/ into presentation/ [wysiwyg:I-33]', () => {
        const upward = inLayer('infrastructure').flatMap((file) =>
            staticImports(join(SRC, file))
                .map((ref) => resolveLocal(ref.specifier, join(SRC, file)))
                .filter(
                    (target): target is string =>
                        !!target &&
                        relative(SRC, target).startsWith(
                            join('lib', 'presentation') + sep
                        )
                )
                .map((target) => `${file} -> ${relative(SRC, target)}`)
        );

        expect(upward).toEqual([]);
    });

    it('keeps the media node view beside its extension', () => {
        // The reason the rule above is satisfiable at all. A node view is React
        // — but it is the extension's own plumbing, so it lives in
        // `infrastructure/`; filing it under `presentation/components` with the
        // rest of the React would force the upward import the previous case
        // forbids.
        const view = join(
            SRC,
            'lib',
            'infrastructure',
            'extensions',
            'media',
            'MediaNodeView',
            'index.tsx'
        );

        expect(existsSync(view)).toBe(true);
        expect(
            staticImports(view).some((ref) => ref.specifier === 'react')
        ).toBe(true);
    });

    it('reads editor state through the one safe wrapper [wysiwyg:I-30]', () => {
        // `useEditorState` on a destroyed editor throws *during render* and
        // React unwinds the whole editor subtree — the toolbar vanishes. The
        // wrapper handles it once; nine call sites remembering to is what this
        // stops. (Its behaviour is pinned in the hook's own spec.)
        const callers = sources()
            .filter((file) => /\buseEditorState\b/.test(code(file)))
            .map((file) => relative(SRC, file));

        expect(callers).toEqual([
            join(
                'lib',
                'presentation',
                'hooks',
                'useLiveEditorState',
                'index.ts'
            )
        ]);

        // And the wrapper is genuinely used, rather than the rule holding
        // because nothing reads editor state any more.
        const users = sources().filter((file) =>
            /\buseLiveEditorState\b/.test(code(file))
        );
        expect(users.length).toBeGreaterThan(5);
    });
});

describe('the overlays', () => {
    it('stops every overlay form from submitting the record [wysiwyg:I-27]', () => {
        // Each of these is portalled in the DOM but **not** in the React tree,
        // and React bubbles synthetic events along the tree — so all three
        // overlays' submits reached the entry editor's `<form>` and
        // saved-and-published the record. The e2e case fires three saves' worth
        // of that regression, but it can only exercise the overlays it opens:
        // the language dialog is a fourth form no browser test reaches, and the
        // next overlay someone adds will be a fifth.
        const withForms = sources()
            .map((file) => ({ file: relative(SRC, file), text: code(file) }))
            .filter((entry) => entry.text.includes('<form'));

        // Not vacuous — there are four of them today.
        expect(withForms.length).toBeGreaterThanOrEqual(4);

        const unguarded = withForms
            .filter((entry) => {
                const forms = entry.text.split('<form').length - 1;
                const stopped = entry.text.split('stopPropagation').length - 1;
                return !entry.text.includes('onSubmit') || stopped < forms;
            })
            .map((entry) => entry.file);

        expect(unguarded).toEqual([]);
    });
});

describe('the style scope', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const scope = `.${WYSIWYG_PROSE_CLASS}`;

    it('hangs every rule off the one scope [wysiwyg:I-34]', () => {
        // The stylesheet is global — the host imports it once — and it restores
        // the prose elements Tailwind's preflight resets. A selector that got
        // out of the scope would restyle headings, lists and tables across the
        // whole admin.
        const rules = selectors(css);

        expect(rules.length).toBeGreaterThan(50);
        expect(rules.filter((one) => !one.includes(scope))).toEqual([]);
    });

    it('moves media by its margins, never by text-align [wysiwyg:I-24]', () => {
        // The rule and its reason are the same fact. An image is a block in
        // the flow, and `text-align` positions a block's inline *children* —
        // so the property the text-alignment extension writes lands on the
        // image and moves nothing. Someone tidying `data-align` into the
        // text extension's own mechanism would produce a stylesheet that
        // looks equivalent and a picture that stays where it was.
        const aligned = declarationBlocks(css).filter((rule) =>
            rule.prelude.includes('data-align')
        );

        // Not vacuous: centre and right, each on figure/img/video.
        expect(aligned).toHaveLength(2);

        for (const rule of aligned) {
            expect(rule.block).toMatch(/margin-inline/);
            expect(rule.block).not.toMatch(/text-align/);
            // And `left` gets no rule at all, because it is where a block
            // already sits — the styling half of "left is never written".
            expect(rule.prelude).not.toMatch(/data-align=.left./);
        }
    });

    it('is the same scope the two surfaces carry [wysiwyg:I-34]', () => {
        // The preview and the editor surface must render identically, and
        // sharing one scope is what makes that structural instead of something
        // to keep in sync. Both take the class from the constant, so a rename
        // cannot leave one of them behind.
        const wearers = sources()
            .filter((file) => /\bWYSIWYG_PROSE_CLASS\b/.test(code(file)))
            .map((file) => relative(SRC, file))
            .filter((file) => !file.startsWith(join('lib', 'domain') + sep))
            .sort();

        expect(wearers).toEqual([
            join(
                'lib',
                'presentation',
                'components',
                'WysiwygEditorPanel',
                'index.tsx'
            ),
            join(
                'lib',
                'presentation',
                'components',
                'WysiwygPreview',
                'index.tsx'
            )
        ]);
    });
});
