import { join } from 'node:path';

const readFileSync = jest.fn();

// Mocked at the module boundary, the way the other specs in this package do
// it: `version.ts` destructures its import, so a `jest.spyOn` on an imported
// namespace never reaches the binding it actually calls.
jest.mock('node:fs', () => ({
    ...jest.requireActual<typeof import('node:fs')>('node:fs'),
    readFileSync: (...args: unknown[]) => readFileSync(...args)
}));

import { cliVersion } from './version';

const realFs = jest.requireActual<typeof import('node:fs')>('node:fs');

/** What the package actually declares — the number the command must print. */
const manifest = join(__dirname, '..', '..', 'package.json');
const declared = JSON.parse(realFs.readFileSync(manifest, 'utf8')).version;

beforeEach(() => {
    jest.clearAllMocks();
    readFileSync.mockImplementation((path: string) =>
        realFs.readFileSync(path, 'utf8')
    );
});

describe('cliVersion', () => {
    it("reports the version in this package's own manifest", () => {
        expect(cliVersion()).toBe(declared);
        expect(declared).toMatch(/^\d+\.\d+\.\d+/);
    });

    // Guards the `../../` in version.ts: that path is only correct because
    // `src/lib` and the compiled `dist/lib` sit at the same depth below the
    // package root, where `pack.mjs` stages the rewritten manifest.
    it('looks for the manifest at the package root', () => {
        cliVersion();

        expect(readFileSync).toHaveBeenCalledWith(manifest, 'utf8');
    });

    it('says so rather than throwing when the manifest cannot be read', () => {
        readFileSync.mockImplementation(() => {
            throw new Error('ENOENT');
        });

        expect(cliVersion()).toBe('unknown');
    });

    it('says so rather than throwing when the manifest has no version', () => {
        readFileSync.mockReturnValue('{"name":"@orthacms/cli"}');

        expect(cliVersion()).toBe('unknown');
    });
});
