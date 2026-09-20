import { mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import { createLocalStorageProvider } from './local-storage-provider';

/** Every file under `dir`, as provider-style keys, sorted. */
async function walk(dir: string, root = dir): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const keys: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            keys.push(...(await walk(full, root)));
        } else {
            keys.push(relative(root, full).split(sep).join('/'));
        }
    }
    return keys.sort();
}

/**
 * The filesystem provider against the shared contract.
 *
 * A real temporary directory, not a mocked `fs`: every claim worth making about
 * this adapter is about bytes and what survives a failure, and a mock can only
 * confirm which calls were made. `storedKeys` is supplied so the all-or-nothing
 * case checks the disk rather than just the rejection — the `.part` file and
 * the directories a failed write creates are exactly what used to be left
 * behind.
 */
const roots = new Map<string, string>();

// covers: media:I-06, media:I-09
describeStorageProvider('media-provider-local', {
    create() {
        const rootDir = mkdtempSync(join(tmpdir(), 'ortha-media-contract-'));
        const provider = createLocalStorageProvider({ rootDir });
        roots.set(provider.id, rootDir);
        return provider;
    },
    cleanup(provider) {
        const rootDir = roots.get(provider.id);
        if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    },
    storedKeys(provider) {
        const rootDir = roots.get(provider.id);
        return rootDir ? walk(rootDir) : [];
    }
});
