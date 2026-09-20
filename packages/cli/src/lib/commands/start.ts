import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT } from '../project';
import { run } from '../run';

/**
 * Runs the built server — one process serving the API and, via the config's
 * `staticDir`, the admin bundle beside it.
 */
export async function startCommand(root: string): Promise<void> {
    const entry = join(root, LAYOUT.serverEntry);

    if (!existsSync(entry)) {
        throw new Error(
            `${LAYOUT.serverEntry} does not exist — run \`ortha build\` first.`
        );
    }

    await run([entry], root);
}
