import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rules that hold across *every* file in the library rather than inside any
 * one of them — the ones a reviewer is supposed to notice in a diff and, on the
 * evidence, does not.
 *
 * All four are silent locally and loud somewhere else. An `@/` import
 * typechecks (`tsconfig` still declares the alias) and only fails when the
 * admin's Vite dev server tries to resolve it out of another package's source.
 * A component missing from `src/index.ts` is invisible until a consumer reaches
 * for it. A literal colour looks right until the theme is switched. An
 * unguarded animation looks right until someone who asked for less motion opens
 * the page. A per-file spot check catches none of them the moment a *new* file
 * is added, which is the case that matters — so these scan the set.
 */
// `vite.config.mts` sets `root: __dirname`, so this is the package directory.
// A wrong answer is not silent — see the first case below.
const packageRoot = process.cwd();
const srcRoot = join(packageRoot, 'src');
const repoRoot = join(packageRoot, '..', '..');

/** Every shipped `.ts`/`.tsx` in `src/` — specs and the vitest shim excluded. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        if (!/\.tsx?$/.test(entry.name)) return [];
        if (entry.name.includes('.spec.')) return [];
        if (entry.name === 'test-setup.ts') return [];
        return [full];
    });
}

/**
 * Comments stripped, so a JSDoc paragraph *about* a colour or an alias is not
 * mistaken for one. Block comments go wholesale; line comments only when the
 * `//` opens the line, which cannot swallow a `https://` inside a string.
 */
function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

/**
 * The top-level argument lists of every `name(...)` call in a file, split on
 * commas that are not nested inside a bracket of any kind.
 */
function callsTo(name: string, code: string): string[][] {
    const calls: string[][] = [];
    for (const match of code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
        let depth = 1;
        let index = match.index + match[0].length;
        const start = index;
        while (index < code.length && depth > 0) {
            if ('([{'.includes(code[index])) depth += 1;
            else if (')]}'.includes(code[index])) depth -= 1;
            index += 1;
        }
        const args: string[] = [];
        let current = '';
        let nesting = 0;
        for (const character of code.slice(start, index - 1)) {
            if ('([{'.includes(character)) nesting += 1;
            else if (')]}'.includes(character)) nesting -= 1;
            if (character === ',' && nesting === 0) {
                args.push(current.trim());
                current = '';
            } else current += character;
        }
        if (current.trim()) args.push(current.trim());
        calls.push(args.filter(Boolean));
    }
    return calls;
}

/** Every single-quoted string literal in a file — i.e. every class list. */
function stringLiterals(code: string): string[] {
    return (code.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []).map((raw) =>
        raw.slice(1, -1)
    );
}

const files = sourceFiles(srcRoot).map((path) => {
    const text = readFileSync(path, 'utf8');
    return {
        /** Repo-relative, so a failure names the file a reviewer has to open. */
        path: relative(repoRoot, path),
        module: relative(srcRoot, path).split(sep).join('/'),
        text,
        code: stripComments(text)
    };
});

describe('library-wide source conventions', () => {
    it('finds the files it is meant to scan', () => {
        // Guards the scans below from the failure mode that would make every
        // one of them vacuous: a walker that returned nothing.
        expect(files.length).toBeGreaterThan(40);
        expect(files.map((file) => file.module)).toContain(
            'lib/components/ui/button.tsx'
        );
    });

    it('imports only through relative paths, never the @/ alias [design-system:I-01]', () => {
        // `tsconfig.json` still declares `@/*`, so this compiles. It is Vite
        // that cannot resolve it when the admin app consumes this package's
        // source, and the symptom is the dev server failing to come up — a
        // long way from the diff that caused it.
        const offenders = files.filter((file) =>
            /(?:from|import|require)\s*\(?\s*'@\//.test(file.code)
        );
        expect(offenders.map((file) => file.path)).toEqual([]);
    });

    it('re-exports every shipped module from src/index.ts [design-system:I-02]', () => {
        const barrel = readFileSync(join(srcRoot, 'index.ts'), 'utf8');
        const exported = new Set(
            (barrel.match(/from '(\.\/[^']+)'/g) ?? []).map((match) =>
                match.slice(6, -1)
            )
        );

        const orphans = files
            .filter((file) => file.module !== 'index.ts')
            .map((file) => ({
                path: file.path,
                specifier:
                    './' +
                    file.module.replace(/\.tsx?$/, '').replace(/\/index$/, '')
            }))
            .filter(({ specifier }) => !exported.has(specifier));

        expect(orphans.map((orphan) => orphan.path)).toEqual([]);
    });

    it('holds no literal colour, only semantic tokens [design-system:I-03]', () => {
        // The theme is two sets of CSS variables and the components are
        // supposed to know only the role. One `#fff` survives the switch and
        // sits on the dark canvas as a light patch.
        const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
        const offenders = files.filter((file) => literal.test(file.code));
        expect(offenders.map((file) => file.path)).toEqual([]);
    });

    it('never puts white text on the brand fill [design-system:I-34]', () => {
        // `bg-brand` is the saturated orange: it clears 3:1 against white as a
        // graphical object and does *not* clear 4.5:1 as text, so the pairing
        // is a 1.4.3 failure wherever it appears. `bg-brand-soft` (the tinted
        // surface) is a different token and is deliberately not matched here.
        const brandFill = /(^|:)bg-brand(\/|$)/;
        const whiteText = /(^|:)text-(white|primary-foreground)(\/|$)/;

        const offenders = files.flatMap((file) =>
            stringLiterals(file.code)
                .filter((literal) => {
                    const tokens = literal.split(/\s+/);
                    return (
                        tokens.some((token) => brandFill.test(token)) &&
                        tokens.some((token) => whiteText.test(token))
                    );
                })
                .map((literal) => `${file.path}: ${literal}`)
        );

        expect(offenders).toEqual([]);
    });

    it('reaches link orange through its own brand-text token [design-system:I-34]', () => {
        // The reason the pairing above never comes up: orange type has a token
        // of its own, darkened to clear AA. Deleting it and falling back to
        // `text-brand` would read as a cosmetic tidy-up.
        const button = files.find(
            (file) => file.module === 'lib/components/ui/button.tsx'
        );
        expect(button?.code).toContain('text-brand-text');
    });

    it('carries no react-intl and no message catalogue [design-system:I-06]', () => {
        // The library stays intl-agnostic so a host can own the one
        // `IntlProvider`; the chrome it has to name itself goes through
        // `DesignSystemLabelsProvider` instead.
        expect(
            files
                .filter((file) => /react-intl|defineMessages/.test(file.code))
                .map((file) => file.path)
        ).toEqual([]);
        expect(
            files
                .filter((file) =>
                    /(^|\/)(messages|locales?)\b/.test(file.module)
                )
                .map((file) => file.path)
        ).toEqual([]);
    });

    /**
     * The second clause of `design-system:I-06`, which the react-intl scan above
     * cannot reach: **every visible string either arrives as a prop or has an
     * English default a host can override**.
     *
     * A hard-coded `<span>Retry</span>` needs no i18n library at all, so it
     * passes every check in this file and every check in
     * `package-manifest.spec.ts`. `labels/index.spec.tsx` covers the one string
     * that has a context default and `localizable-copy.spec.tsx` the props that
     * carry English defaults; nothing enumerated the library's own text.
     *
     * Read with TypeScript's own parser rather than a regex — `>` opens a
     * generic and closes a comparison at least as often as it closes a tag —
     * the technique `packages/utils/admin/src/leaf-hygiene.spec.ts` uses for the
     * same rule in the other leaf.
     */
    /** Every non-blank JSX text node in the library, with the file it is in. */
    function jsxTextNodes(): { module: string; text: string }[] {
        const found: { module: string; text: string }[] = [];
        for (const file of files) {
            if (!file.path.endsWith('.tsx')) continue;
            const parsed = ts.createSourceFile(
                file.module,
                file.text,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX
            );
            const visit = (node: ts.Node) => {
                if (ts.isJsxText(node)) {
                    const text = node.getText().trim();
                    if (text) found.push({ module: file.module, text });
                }
                ts.forEachChild(node, visit);
            };
            visit(parsed);
        }
        return found;
    }

    /**
     * The literals that are allowed to stay, and why each one is not a string a
     * host would ever want to translate. Extending this list is the deliberate
     * act the scan exists to force.
     */
    const ALLOWED_LITERALS = [
        // A proper noun. Translating a product name is not localization.
        { module: 'lib/components/ui/logo.tsx', text: 'Ortha CMS' },
        // Inside a `role="presentation" aria-hidden="true"` span, so it is read
        // by nobody and displayed to nobody — the ellipsis glyph beside it is
        // what the sighted user sees. Not a visible string in any sense the
        // invariant means.
        { module: 'lib/components/ui/breadcrumb.tsx', text: 'More' }
    ];

    it('hard-codes no visible string of its own [design-system:I-06]', () => {
        const offenders = jsxTextNodes()
            .filter(
                (node) =>
                    !ALLOWED_LITERALS.some(
                        (allowed) =>
                            allowed.module === node.module &&
                            allowed.text === node.text
                    )
            )
            .map((node) => `${node.module}: ${node.text}`);

        expect(offenders).toEqual([]);
    });

    it('leaves every hard-coded accessible name overridable by the caller [design-system:I-06]', () => {
        // The other half of "arrives as a prop". `Breadcrumb` and `Pagination`
        // each write an English `aria-label` — announced text, not decoration —
        // and both are acceptable for one reason only: `{...props}` is spread
        // *after* it, so a consumer passing `aria-label` wins. Written before
        // the spread instead, the same line becomes a name no host can change,
        // and it reads identically in a diff.
        const offenders: string[] = [];
        const NAMING = new Set([
            'aria-label',
            'aria-roledescription',
            'aria-valuetext',
            'alt',
            'placeholder',
            'title'
        ]);

        for (const file of files) {
            if (!file.path.endsWith('.tsx')) continue;
            const parsed = ts.createSourceFile(
                file.module,
                file.text,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX
            );
            const visit = (node: ts.Node) => {
                if (ts.isJsxAttributes(node)) {
                    node.properties.forEach((property, index) => {
                        if (!ts.isJsxAttribute(property)) return;
                        if (!NAMING.has(property.name.getText())) return;
                        const value = property.initializer;
                        const literal =
                            value &&
                            (ts.isStringLiteral(value) ||
                                (ts.isJsxExpression(value) &&
                                    value.expression &&
                                    ts.isStringLiteral(value.expression)));
                        if (!literal) return;
                        // Overridable iff some later attribute is a spread.
                        const overridable = node.properties
                            .slice(index + 1)
                            .some((later) => ts.isJsxSpreadAttribute(later));
                        if (!overridable) {
                            offenders.push(
                                `${file.module}: ${property.getText()}`
                            );
                        }
                    });
                }
                ts.forEachChild(node, visit);
            };
            visit(parsed);
        }

        expect(offenders).toEqual([]);
    });

    it('passes the caller className last into every cn call [design-system:I-05]', () => {
        // `cn` is `twMerge(clsx(...))`, so "the caller wins" is not a property
        // of `cn` at all — it is a property of the *argument order* at 161 call
        // sites. `utils.spec.ts` pins the merge; this pins the order, which is
        // the half a component author can get wrong. `cn(className, 'px-4')`
        // reads identically and silently ignores every override a page passes.
        const offenders = files.flatMap((file) =>
            callsTo('cn', file.code)
                .filter(
                    (args) =>
                        args.includes('className') &&
                        args[args.length - 1] !== 'className'
                )
                .map((args) => `${file.path}: cn(${args.join(', ')})`)
        );

        expect(offenders).toEqual([]);
    });

    it('adds no landmark beyond the four it documents [design-system:I-18]', () => {
        // A landmark is a jump target: every one the library invents lands in
        // every screen-reader user's rotor on every page, unnamed and
        // unexplained. `region` is the one shadcn reaches for on a scroll
        // container, and it is why `Table` and the sidebar scrollport both take
        // `group` instead.
        const landmarks = new Set([
            'banner',
            'complementary',
            'contentinfo',
            'form',
            'main',
            'navigation',
            'region',
            'search'
        ]);

        const declared = new Set(
            files.flatMap((file) =>
                [
                    ...file.code.matchAll(/role=(?:"([a-z]+)"|\{([^}]*)\})/g)
                ].flatMap(([, literal, expression]) =>
                    literal
                        ? [literal]
                        : [...(expression ?? '').matchAll(/'([a-z]+)'/g)].map(
                              ([, role]) => role
                          )
                )
            )
        );

        expect(
            [...declared].filter((role) => landmarks.has(role)).sort()
        ).toEqual(['complementary', 'navigation']);
    });

    it('creates its landmark elements in four files and no others [design-system:I-18]', () => {
        // The other half of the enumeration: `<main>` and `<nav>` are landmarks
        // by tag, so an allowlist of roles alone would miss them.
        const holders = (tag: string) =>
            files
                .filter((file) => new RegExp(`<${tag}[\\s>]`).test(file.code))
                .map((file) => file.module)
                .sort();

        expect(holders('main')).toEqual([
            'lib/components/ui/app-loader.tsx',
            'lib/components/ui/sidebar.tsx'
        ]);
        expect(holders('nav')).toEqual([
            'lib/components/ui/breadcrumb.tsx',
            'lib/components/ui/pagination.tsx',
            'lib/components/ui/tab-nav.tsx'
        ]);
    });

    it('carries no server side at all [design-system:I-37]', () => {
        // Not a plugin: no module to import, no controller to mount, no table
        // to migrate, no permission key to grant.
        const serverShaped =
            /@(?:Injectable|Controller|Module|Get|Post|Patch|Delete)\(|\bpgTable\(|from '@nestjs\/|from 'drizzle-orm/;
        const offenders = files.filter((file) => serverShaped.test(file.code));
        expect(offenders.map((file) => file.path)).toEqual([]);
    });
});

/**
 * Reduced motion, checked over the component set rather than at one call site.
 *
 * The suppression here is per-component opt-in — a `motion-reduce:` variant on
 * the class list, or a `prefers-reduced-motion` block in the stylesheet — so
 * the failure is never a broken rule, it is a *new* animation that simply never
 * got one. That is invisible to any test naming a component, and it is why this
 * enumerates every animation the library actually ships.
 */
describe('motion', () => {
    /**
     * Properties a reduced-motion replacement animation may touch: ones that
     * cannot displace, rotate or resize anything. `transform` is the whole
     * point of the list being a list.
     */
    const MOTIONLESS = new Set([
        'opacity',
        'color',
        'background-color',
        'border-color',
        'fill',
        'stroke'
    ]);

    // Comments out: this file is mostly prose, and an unstripped `/* … */`
    // above a rule would be swallowed into that rule's selector.
    const styles = readFileSync(join(srcRoot, 'styles.css'), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        ''
    );

    const reducedMotionBlock =
        /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g;

    /**
     * The innermost rules of a stylesheet fragment, each with the value of its
     * `animation` shorthand. `[^{}]` never crosses a brace, so an at-rule's own
     * header is skipped and only the rules inside it come back.
     */
    function rulesIn(css: string) {
        return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
            ([, selectorList, body]) => ({
                selectors: selectorList
                    .split(',')
                    .map((selector) => selector.trim())
                    .filter(Boolean),
                animation:
                    body.match(/animation:\s*([^;]+)/)?.[1].trim() ?? null
            })
        );
    }

    /** The property names one `@keyframes` block declares. */
    function keyframeProperties(name: string): string[] {
        const block = styles.match(
            new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`)
        );
        return [...(block?.[1] ?? '').matchAll(/([a-z-]+)\s*:/g)].map(
            ([, property]) => property
        );
    }

    /** Selectors turned off inside a reduced-motion block. */
    const suppressed = new Set(
        [...styles.matchAll(reducedMotionBlock)].flatMap(([block]) =>
            rulesIn(block)
                .filter((rule) => rule.animation === 'none')
                .flatMap((rule) => rule.selectors)
        )
    );

    /**
     * Selectors a reduced-motion block gives a *different* animation to, one
     * that declares no property capable of moving anything.
     *
     * `animation: none` is the usual answer and the safe default, but it is not
     * the only correct one. An indeterminate loading spinner that stops reads
     * as a frozen app, and the rule being enforced is about **motion**, not
     * about withholding feedback — so a replacement is allowed here exactly
     * when it cannot move the element: opacity and colour, never `transform`.
     */
    const motionFree = new Set(
        [...styles.matchAll(reducedMotionBlock)].flatMap(([block]) =>
            rulesIn(block)
                .filter((rule) => rule.animation && rule.animation !== 'none')
                .filter((rule) => {
                    const name = (rule.animation as string).split(/\s+/)[0];
                    const properties = keyframeProperties(name);
                    return (
                        properties.length > 0 &&
                        properties.every((property) => MOTIONLESS.has(property))
                    );
                })
                .flatMap((rule) => rule.selectors)
        )
    );

    it('finds the stylesheet it is meant to parse', () => {
        expect(suppressed.size).toBeGreaterThan(0);
    });

    it('suppresses every animation the stylesheet declares [design-system:I-30]', () => {
        // Every rule that starts an animation, matched against the two sets
        // above. Add a keyframed class to `styles.css` without a reduced-motion
        // twin — of either kind — and it lands here.
        const animated = rulesIn(styles.replace(reducedMotionBlock, ''))
            .filter((rule) => rule.animation && rule.animation !== 'none')
            .flatMap((rule) => rule.selectors);

        expect(animated.length).toBeGreaterThan(0);
        expect(
            animated.filter(
                (selector) =>
                    !suppressed.has(selector) && !motionFree.has(selector)
            )
        ).toEqual([]);
    });

    it('is not quietly relying on a Tailwind animation plugin [design-system:I-30]', () => {
        // `animate-in` / `fade-in-0` / `zoom-in-95` are all over `dialog`,
        // `sheet` and `tooltip`, and they are **dead**: neither
        // tailwindcss-animate nor tw-animate-css is installed, and the admin's
        // stylesheet loads no `@plugin`, so those classes generate no CSS. The
        // scan below leans on that, so the premise is checked rather than
        // assumed — installing the plugin turns a dozen unguarded animations on
        // at once and fails here first.
        const rootManifest = readFileSync(
            join(repoRoot, 'package.json'),
            'utf8'
        );
        expect(rootManifest).not.toMatch(
            /"(tailwindcss-animate|tw-animate-css)"/
        );
        expect(
            readFileSync(join(repoRoot, 'apps/admin/src/styles.css'), 'utf8')
        ).not.toContain('@plugin');
    });

    /**
     * The spinner is the one animation here that must survive reduced motion,
     * and the case exists because the obvious fix is the wrong one.
     *
     * A stopped indeterminate loader reads as a frozen app: its only job is to
     * say "still working", and someone who asked for less motion did not ask to
     * be told less. So the rule is *no movement*, not *no feedback* — and a
     * later change that closes this the easy way, with
     * `.ds-spinner { animation: none }` in the reduced-motion block, fails here
     * instead of shipping a dead glyph that looks exactly like a hung request.
     */
    it('replaces the spinner rotation rather than stopping it [design-system:I-30]', () => {
        const reduced = [...styles.matchAll(reducedMotionBlock)]
            .flatMap(([block]) => rulesIn(block))
            .filter((rule) => rule.selectors.includes('.ds-spinner'));

        expect(reduced).toHaveLength(1);

        const animation = reduced[0].animation as string;
        expect(animation).not.toBe('none');

        // It still animates, and it animates nothing that can move.
        const [name, duration] = animation.split(/\s+/);
        const properties = keyframeProperties(name);
        expect(properties.length).toBeGreaterThan(0);
        expect(
            properties.filter((property) => !MOTIONLESS.has(property))
        ).toEqual([]);

        // Slow enough never to read as a flash — WCAG 2.3.1's threshold is
        // 3 Hz, and one cycle here is a second or more.
        expect(duration).toMatch(/^\d+(\.\d+)?s$/);
        expect(Number.parseFloat(duration)).toBeGreaterThanOrEqual(1);

        // The control: the animation this replaces really is a movement, so
        // the case cannot pass over a component that never moved to begin with.
        const base = rulesIn(styles.replace(reducedMotionBlock, '')).find(
            (rule) => rule.selectors.includes('.ds-spinner')
        );
        expect(base?.animation).toBeTruthy();
        expect(
            keyframeProperties((base?.animation as string).split(/\s+/)[0])
        ).toContain('transform');

        // And the component wears the class, or the two rules above are about
        // a selector nothing renders.
        const spinner = files.find(
            (file) => file.module === 'lib/components/ui/spinner.tsx'
        );
        expect(spinner?.code).toContain('ds-spinner');
    });

    it('pairs every live animate-* utility with a motion-reduce escape [design-system:I-30]', () => {
        // No exemptions. `Spinner` used to be one — `animate-spin` with no
        // `motion-reduce:` twin — and it is now `.ds-spinner`, which owns both
        // branches in the stylesheet and is checked by the case above.
        const live = /(^|:)animate-(?!in\b|out\b|none\b)[a-z-]+$/;

        const offenders = files.flatMap((file) =>
            stringLiterals(file.code)
                .filter((literal) => {
                    const tokens = literal.split(/\s+/);
                    return (
                        tokens.some((token) => live.test(token)) &&
                        !tokens.includes('motion-reduce:animate-none')
                    );
                })
                .map((literal) => `${file.path}: ${literal}`)
        );

        expect(offenders).toEqual([]);
    });

    it('animates the wizard step by transform alone, never opacity [design-system:I-31]', () => {
        // The point of the constraint: a paused motion clock — a background
        // tab, a print, a reduced-motion user landing on the `animation: none`
        // rule above — freezes the step on its `from` frame. If that frame
        // carried `opacity: 0` the step's content would simply not be there.
        const keyframes = styles.match(
            /@keyframes wizard-step-in \{([\s\S]*?)\n\}/
        );
        expect(keyframes).not.toBeNull();

        const properties = [
            ...(keyframes?.[1] ?? '').matchAll(/([a-z-]+)\s*:/g)
        ].map(([, property]) => property);

        expect(properties.length).toBeGreaterThan(0);
        expect([...new Set(properties)]).toEqual(['transform']);
    });

    it('is the class WizardStepCard actually applies [design-system:I-31]', () => {
        // Ties the stylesheet above to the component, so the keyframes under
        // test are the ones that run rather than a same-named leftover.
        const wizard = files.find(
            (file) => file.module === 'lib/components/ui/wizard.tsx'
        );
        expect(wizard?.code).toContain("'wizard-step-in'");
    });
});

/**
 * The palette's light/dark pairing.
 *
 * Every component in the library resolves its colours through `--color-*` at
 * runtime, which is what lets `.dark` re-declare them without a rebuild — and
 * what makes a token declared in only one of the two blocks a component that
 * renders the light value on the dark canvas. The failure is silent in review
 * (the diff shows one perfectly reasonable new token) and silent in the light
 * theme, which is where it is looked at.
 *
 * ## Why this needs a list rather than a set comparison
 *
 * The invariant reads "either overridden or deliberately inherited", and a
 * judgment once retired it as unfalsifiable on exactly that wording: a
 * disjunction ending in "or deliberately" is satisfied by every token, so an
 * assertion over the two sets passes by construction. That is a wording
 * problem, not an unobservable one. What makes it testable is naming the
 * inheritors — three families that are the same colour in both themes on
 * purpose — so that everything *else* must be paired, and a new unpaired token
 * has to be argued for here instead of merely appearing.
 *
 * The list is short and each family has a reason:
 *
 * - `--color-sidebar-*` — the panel's chrome is authored dark in both themes,
 *   so the shell keeps one identity while the content canvas flips.
 * - `--color-nav-*` — the nav-icon accents are tuned for contrast against that
 *   permanently dark chrome, so a dark-mode variant would be the same colour.
 * - `--color-avatar-*` — identity anchors. An avatar that changed hue with the
 *   theme would stop being recognisable, which is the one job it has.
 *
 * `--radius` is excluded rather than allow-listed: it is not a palette token.
 */
describe('the admin palette', () => {
    /** Both copies of the palette: the workspace's admin and the one shipped. */
    const PALETTES = {
        'apps/admin': 'apps/admin/src/styles.css',
        'the scaffolder template':
            'packages/create-ortha-app/templates/default/apps/admin/src/styles.css'
    };

    /** Token prefixes that are the same colour in both themes, on purpose. */
    const INHERITED = ['--color-sidebar', '--color-nav-', '--color-avatar-'];

    /** Declarations that are not colours and so are outside the rule. */
    const NOT_A_COLOUR = ['--radius'];

    /** The top-level blocks of a stylesheet, by selector, comments stripped. */
    function blocks(css: string): { selector: string; body: string }[] {
        const out: { selector: string; body: string }[] = [];
        const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
        let index = 0;
        while (index < text.length) {
            const open = text.indexOf('{', index);
            if (open < 0) break;
            const selector = text.slice(index, open).trim().split('\n').pop();
            let depth = 1;
            let cursor = open + 1;
            while (cursor < text.length && depth > 0) {
                if (text[cursor] === '{') depth += 1;
                else if (text[cursor] === '}') depth -= 1;
                cursor += 1;
            }
            out.push({
                selector: (selector ?? '').trim(),
                body: text.slice(open + 1, cursor - 1)
            });
            index = cursor;
        }
        return out;
    }

    /** The custom properties declared directly in the named blocks. */
    function declared(css: string, selectors: string[]): string[] {
        return blocks(css)
            .filter((block) => selectors.includes(block.selector))
            .flatMap((block) =>
                [...block.body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(
                    ([, token]) => token
                )
            );
    }

    it.each(Object.entries(PALETTES))(
        '%s overrides every light token in .dark, bar the three inherited families [design-system:I-04]',
        (_name, path) => {
            const css = readFileSync(join(repoRoot, path), 'utf8');
            const light = declared(css, ['@theme', ':root']);
            const dark = new Set(declared(css, ['.dark']));

            // The premise: this is parsing a real palette, not an empty match.
            expect(light.length).toBeGreaterThan(50);
            expect(dark.size).toBeGreaterThan(40);

            const unpaired = light.filter(
                (token) =>
                    !dark.has(token) &&
                    !NOT_A_COLOUR.includes(token) &&
                    !INHERITED.some((prefix) => token.startsWith(prefix))
            );

            // Delete any `.dark` override above and the token it belonged to
            // lands here — which is the defect: a component asking for it on
            // the dark canvas gets the light value.
            expect(unpaired).toEqual([]);
        }
    );

    it.each(Object.entries(PALETTES))(
        '%s does not re-declare an inherited family in .dark [design-system:I-04]',
        (_name, path) => {
            // The other direction, and the reason the allow-list is by prefix
            // rather than a bare exclusion: an inherited family that acquired a
            // `.dark` override is no longer inherited, and the list above has
            // gone stale rather than the stylesheet being wrong. Failing here
            // is how that gets noticed.
            const css = readFileSync(join(repoRoot, path), 'utf8');
            const overridden = declared(css, ['.dark']).filter((token) =>
                INHERITED.some((prefix) => token.startsWith(prefix))
            );

            expect(overridden).toEqual([]);
        }
    );

    it('declares the same tokens in both copies [design-system:I-04]', () => {
        // The scaffolder ships its own copy of the palette, so the rule above
        // is only as good as the two files agreeing on what the palette *is*.
        // Comments differ deliberately (the template's are written for someone
        // who has just scaffolded); the token names must not.
        const tokensOf = (path: string) => {
            const css = readFileSync(join(repoRoot, path), 'utf8');
            return {
                light: declared(css, ['@theme', ':root']).sort(),
                dark: declared(css, ['.dark']).sort()
            };
        };

        expect(tokensOf(PALETTES['the scaffolder template'])).toEqual(
            tokensOf(PALETTES['apps/admin'])
        );
    });
});
