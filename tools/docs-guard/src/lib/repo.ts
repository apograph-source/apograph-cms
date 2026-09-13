import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The workspace root, found by walking up from this file until `nx.json`
 * appears. A relative `../../..` would be counted from wherever the compiled
 * spec happens to sit, which is exactly the kind of hand-maintained number
 * this project exists to remove.
 */
export const repoRoot = ((): string => {
    let dir = __dirname;
    while (!existsSync(join(dir, 'nx.json'))) {
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(
                'workspace root (nx.json) not found above ' + __dirname
            );
        }
        dir = parent;
    }
    return dir;
})();

/** Read a workspace file by its repo-relative path. */
export const readRepoFile = (relative: string): string =>
    readFileSync(join(repoRoot, relative), 'utf-8');

/** Directory entries of a repo-relative directory, sorted. */
export const readRepoDir = (relative: string): string[] =>
    readdirSync(join(repoRoot, relative)).sort();

export const repoPathExists = (relative: string): boolean =>
    existsSync(join(repoRoot, relative));

/**
 * Subdirectories of a repo-relative directory, sorted — following symlinks,
 * because `.claude/skills` is a directory of links into `.agents/skills`.
 */
export const readRepoSubdirectories = (relative: string): string[] =>
    readdirSync(join(repoRoot, relative), { withFileTypes: true })
        .filter(
            (entry) =>
                statSync(join(repoRoot, relative, entry.name), {
                    throwIfNoEntry: false
                })?.isDirectory() ?? false
        )
        .map((entry) => entry.name)
        .sort();

/**
 * A markdown document with every run of whitespace collapsed to one space.
 *
 * The root documents are hard-wrapped at 80 columns, so a claim and the number
 * that qualifies it routinely sit on different lines and a pattern written
 * against the rendered sentence matches nothing. Collapsing first means a
 * claim's pattern survives a re-wrap — which is the one edit guaranteed to
 * happen to a sentence someone corrects.
 */
export const readDocument = (relative: string): string =>
    readRepoFile(relative).replace(/\s+/g, ' ');
