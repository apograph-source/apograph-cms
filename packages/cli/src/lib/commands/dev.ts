import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Halves } from '../args';
import { LAYOUT } from '../project';
import { spawnNode, superviseUntilExit, tscBin, viteBin } from '../run';
import { buildCommand } from './build';

/**
 * The development stack in one terminal: `tsc --watch`, `node --watch` on the
 * compiled entry, and the Vite dev server.
 *
 * The one-shot build first is load-bearing, not tidiness. `node --watch`
 * **cannot recover from a missing entry point** — handed a path that does not
 * exist yet, it stays alive watching nothing and never boots, which reads as a
 * server that hung rather than one started a second too early. So `dist/` is
 * populated before the watchers race for it. (The monorepo solves the same
 * problem with a separate `dev:prebuild` target; see the root AGENTS.md.)
 *
 * `--server` and `--admin` run one half on its own, which is what the monorepo
 * offers as `start:server` / `start:admin` — the API alone while the admin is
 * served from somewhere else, or the admin alone against an API already up.
 * Both were accepted and ignored here: `ortha dev --server` parsed, brought
 * Vite up anyway, and said nothing about it.
 */
export async function devCommand(
    root: string,
    options: Partial<Halves> = {}
): Promise<void> {
    const children: ChildProcess[] = [];

    if (!options.adminOnly) {
        await buildCommand(root, { serverOnly: true });

        children.push(
            // `--preserveWatchOutput` stops tsc clearing the screen on every
            // recompile, which otherwise wipes the Nest logs sharing this
            // terminal.
            spawnNode(
                [
                    tscBin(root),
                    '-p',
                    LAYOUT.serverTsconfig,
                    '--watch',
                    '--preserveWatchOutput'
                ],
                root
            ),
            spawnNode(['--watch', join(root, LAYOUT.serverEntry)], root)
        );
    }

    if (!options.serverOnly) {
        const hasAdmin = existsSync(join(root, LAYOUT.adminIndex));

        // Without an admin, `ortha dev` runs the API and says nothing — but
        // `ortha dev --admin` asked for the admin and nothing else, and
        // supervising an empty set would exit 0 with no output at all.
        if (!hasAdmin && options.adminOnly) {
            throw new Error(
                `No ${LAYOUT.adminIndex} — this app has no admin to run. ` +
                    `Drop --admin to run the API.`
            );
        }

        if (hasAdmin) {
            children.push(
                spawnNode([viteBin(root), '--config', LAYOUT.adminConfig], root)
            );
        }
    }

    await superviseUntilExit(children);
}
