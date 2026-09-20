import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * This package's own version, for `ortha --version`.
 *
 * Read from `package.json` at runtime rather than baked into the source, so
 * the number the command prints is the one npm installed — `nx release`
 * rewrites the manifest and never touches the code, and a constant here would
 * start lying at the first release nobody remembered to bump it in.
 *
 * `../../` holds in both layouts this file ships in, which is the reason the
 * lookup lives in `lib/` rather than beside `cli.ts`: `src/lib/version.ts` and
 * the compiled `dist/lib/version.js` are each two levels below the package
 * root, and `tools/release/pack.mjs` stages the rewritten manifest at that same
 * root. Move this file up or down a directory and the path has to move with it.
 */
export function cliVersion(): string {
    const manifest = join(__dirname, '..', '..', 'package.json');

    try {
        const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
            version?: unknown;
        };

        if (typeof version === 'string') return version;
    } catch {
        // Fall through to the same answer an unversioned manifest gets.
    }

    // Deliberately not a throw. `--version` is what someone runs to put a
    // number in a bug report, and failing the command outright tells them
    // less than admitting the manifest could not be read.
    return 'unknown';
}
