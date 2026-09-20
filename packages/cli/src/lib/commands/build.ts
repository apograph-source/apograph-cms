import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT } from '../project';
import { run, tscBin, viteBin } from '../run';

/**
 * Compiles the server with the app's `tsc` and, unless told otherwise, builds
 * the admin bundle with the app's Vite.
 *
 * **Deliberately not bundled.** Every Ortha plugin locates its migrations as
 * `join(__dirname, '../../../migrations')`, which resolves to its own package
 * root inside `node_modules` — and stops resolving the moment a bundler
 * flattens those files into one. The monorepo's `apps/server` gets away with
 * webpack only because it must inline packages it consumes from source; an
 * installed app has no such problem, so it leaves `node_modules` alone.
 */
export async function buildCommand(
    root: string,
    options: { serverOnly?: boolean; adminOnly?: boolean } = {}
): Promise<void> {
    if (!options.adminOnly) {
        console.log('Compiling the server…');
        await run([tscBin(root), '-p', LAYOUT.serverTsconfig], root);
    }

    if (options.serverOnly) return;

    if (!existsSync(join(root, LAYOUT.adminIndex))) {
        console.log(`No ${LAYOUT.adminIndex} — skipping the admin build.`);
        return;
    }

    console.log('Building the admin bundle…');
    // `--config`, because the config lives inside the app rather than at the
    // project root: Vite looks for one in the working directory and would
    // otherwise build with its defaults, silently producing a bundle from the
    // wrong root.
    await run([viteBin(root), 'build', '--config', LAYOUT.adminConfig], root);
}
