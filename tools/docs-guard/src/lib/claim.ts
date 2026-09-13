import { readDocument, readRepoFile } from './repo';

/** Number words the root documents use in place of digits. */
const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20
};

/**
 * The number a document states, whether it is written `**14**` or `fourteen`.
 * Both spellings appear in the same sentence — the total as a digit, the
 * breakdown as words — and a guard that only understood one of them would
 * leave the other free to drift.
 */
export const asNumber = (stated: string): number => {
    const word = NUMBER_WORDS[stated.toLowerCase()];
    if (word !== undefined) return word;
    const digits = Number(stated);
    if (Number.isInteger(digits)) return digits;
    throw new Error(`"${stated}" is not a number this guard can read`);
};

/**
 * The capture groups of the one place `pattern` matches in `document`.
 *
 * Matching zero times fails as loudly as matching a wrong value: it means the
 * sentence was rewritten and the guard is now pinning nothing. Matching twice
 * fails because the pattern no longer identifies a single claim, so the guard
 * would silently check only the first of them.
 */
export const claimIn = (relative: string, pattern: RegExp): string[] => {
    const matches = [
        ...readDocument(relative).matchAll(
            new RegExp(
                pattern.source,
                pattern.flags.includes('g')
                    ? pattern.flags
                    : pattern.flags + 'g'
            )
        )
    ];
    if (matches.length !== 1) {
        throw new Error(
            `${relative}: expected exactly one sentence matching ${pattern}, found ${matches.length}. ` +
                `The claim was reworded — re-point the pattern at it (or delete the claim) rather than deleting this guard.`
        );
    }
    return matches[0].slice(1);
};

/** The single number a document states at `pattern`'s first capture group. */
export const numberClaimedIn = (relative: string, pattern: RegExp): number =>
    asNumber(claimIn(relative, pattern)[0]);

/** One row of a project-map table: its first two cells. */
export type ProjectMapRow = { project: string; packageName: string };

/**
 * The rows of every markdown table in a document, as `{ project, packageName }`
 * pairs — the shape both tables in CONTEXT-MAP.md share.
 *
 * Read from the raw file: a table is line-oriented, so this is the other place
 * the documents' formatting carries meaning.
 */
export const projectMapRows = (relative: string): ProjectMapRow[] =>
    readRepoFile(relative)
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .map((line) =>
            line
                .split('|')
                .slice(1, 3)
                .map((cell) => cell.trim().replace(/`/g, ''))
        )
        .filter(
            ([project]) =>
                project.length > 0 &&
                !/^-+$/.test(project) &&
                project !== 'Project'
        )
        .map(([project, packageName]) => ({ project, packageName }));
