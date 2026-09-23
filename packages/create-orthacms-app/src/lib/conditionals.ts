/**
 * `orthacms:if` blocks — how one template serves every feature combination.
 *
 * A marker is any line containing the directive, whatever comment syntax wraps
 * it, so the same three forms work in TypeScript, YAML, `.env` and Markdown:
 *
 *     // orthacms:if copilot
 *     import { CopilotPlugin } from '@orthacms/copilot-server';
 *     // orthacms:end
 *
 *     # orthacms:ifnot graphql
 *     # (REST only — no GraphQL endpoint is mounted.)
 *     # orthacms:end
 *
 * The marker lines are always removed; the body survives only when the
 * condition holds. Blocks may nest, and an inner block is only reached when
 * the outer one is kept.
 *
 * Deliberately line-based rather than an expression language. The templates are
 * read far more often than they are written — someone opening
 * `plugins.ts` should see the real file with a few comments in it, not a
 * templating dialect — and every condition this needs is "is this feature on".
 *
 * **Not used for `package.json`.** Dropping lines from JSON produces a trailing
 * comma and an app that will not install, blaming the template rather than the
 * feature that was switched off; dependencies are assembled in `features.ts`
 * instead.
 */

/**
 * A trailing comment closer, so a block-comment directive works too — `*\/`
 * for CSS and C-style block comments, `-->` for HTML.
 */
const CLOSER = String.raw`(?:\s*(?:\*\/|-->))?`;

const IF = new RegExp(
    String.raw`(^|\s)orthacms:if\s+([a-z0-9-]+)${CLOSER}\s*$`
);
const IFNOT = new RegExp(
    String.raw`(^|\s)orthacms:ifnot\s+([a-z0-9-]+)${CLOSER}\s*$`
);
const END = new RegExp(String.raw`(^|\s)orthacms:end${CLOSER}\s*$`);

/** A directive found on a line, if any. */
interface Directive {
    kind: 'if' | 'ifnot' | 'end';
    flag?: string;
}

/** Reads the directive on `line`, or `undefined` for an ordinary line. */
function directiveOf(line: string): Directive | undefined {
    const trimmed = line.trimEnd();

    const ifMatch = IF.exec(trimmed);
    if (ifMatch) return { kind: 'if', flag: ifMatch[2] };

    const ifNotMatch = IFNOT.exec(trimmed);
    if (ifNotMatch) return { kind: 'ifnot', flag: ifNotMatch[2] };

    if (END.test(trimmed)) return { kind: 'end' };

    return undefined;
}

/**
 * Applies every `orthacms:if` block in `contents` against the enabled `flags`.
 *
 * @throws when a block is left open, which would otherwise silently swallow the
 * rest of the file — a missing `orthacms:end` in `plugins.ts` deletes every plugin
 * below it, and the app boots with no API rather than failing to render.
 */
export function applyConditionals(
    contents: string,
    flags: ReadonlySet<string>,
    file = 'template'
): string {
    const lines = contents.split('\n');
    const kept: string[] = [];
    // One entry per open block: whether its body is being written out. A nested
    // block inside a dropped one stays dropped whatever its own condition says.
    const stack: boolean[] = [];
    const writing = (): boolean => stack.every(Boolean);

    for (const line of lines) {
        const directive = directiveOf(line);

        if (!directive) {
            if (writing()) kept.push(line);
            continue;
        }

        if (directive.kind === 'end') {
            if (stack.length === 0) {
                throw new Error(
                    `${file}: an \`orthacms:end\` with no matching \`orthacms:if\`.`
                );
            }
            stack.pop();
            continue;
        }

        const holds =
            directive.kind === 'if'
                ? flags.has(directive.flag as string)
                : !flags.has(directive.flag as string);

        stack.push(holds);
    }

    if (stack.length > 0) {
        throw new Error(
            `${file}: ${stack.length} unclosed \`orthacms:if\` block(s) — every ` +
                `one needs an \`orthacms:end\`, or the rest of the file is dropped.`
        );
    }

    return collapseBlankRuns(kept).join('\n');
}

/**
 * Collapses runs of three or more blank lines into one.
 *
 * Removing a block almost always leaves the blank line that separated it behind
 * next to the one after it. Without this every generated file carries a scar
 * wherever a feature was switched off, which reads as sloppiness in the very
 * first file anyone opens.
 */
function collapseBlankRuns(lines: readonly string[]): string[] {
    const out: string[] = [];
    let blanks = 0;

    for (const line of lines) {
        if (line.trim() === '') {
            blanks += 1;
            if (blanks > 1) continue;
        } else {
            blanks = 0;
        }
        out.push(line);
    }

    return out;
}
