import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as publicApi from '../index';

/** This package's root — `packages/protection/domain`. */
const PACKAGE = join(__dirname, '..', '..');

/** Every `.ts` file under a directory, specs excluded. */
function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return sources(path);
        if (!/\.tsx?$/.test(name)) return [];
        if (/\.spec\.tsx?$/.test(name)) return [];
        return [path];
    });
}

/** Every module specifier a file imports from. */
function imports(path: string): string[] {
    const text = readFileSync(path, 'utf-8');
    return [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

describe('@orthacms/protection-domain is dependency-free', () => {
    /**
     * The kernel is the one place a React panel, a Nest guard and a tool
     * handler can all read the rule from, and that is only true while it needs
     * none of their worlds. A dependency here is not a weight problem — it is
     * the moment the admin bundle starts pulling in whatever the server needed,
     * or the decision stops being shareable and gets copied instead. A copied
     * approval count is a button that disagrees with the API that refuses it.
     */
    it('declares no dependencies at all', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE, 'package.json'), 'utf-8')
        );

        expect(manifest.dependencies).toBeUndefined();
        expect(manifest.peerDependencies).toBeUndefined();
    });

    it('imports nothing outside itself', () => {
        for (const path of sources(join(PACKAGE, 'src'))) {
            for (const specifier of imports(path)) {
                expect(specifier).toMatch(/^\./);
            }
        }
    });
});

describe('the public API', () => {
    /**
     * `content/domain` already exports `canPublish` — the publish gate, which
     * answers whether the entry is *complete*. Protection answers whether this
     * person may *ship* it. Two functions of that name deciding different
     * halves of one button is precisely the two-authorities confusion ADR-0015
     * exists to prevent, and the design doc names the collision outright. The
     * cheapest moment to stop it is before anything imports either.
     */
    it('does not export a second canPublish', () => {
        expect(Object.keys(publicApi)).not.toContain('canPublish');
    });

    it('exports the decision under its own name', () => {
        expect(typeof publicApi.evaluateProtection).toBe('function');
    });
});
