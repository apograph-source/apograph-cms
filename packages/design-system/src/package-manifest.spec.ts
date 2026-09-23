import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest is the package's contract with eighteen consumers, and it is the
 * only part of that contract a reviewer cannot see by reading a component.
 *
 * Three separate promises live in it: what a consumer may import (one root plus
 * a stylesheet), what a consumer has to install for themselves (react and
 * react-dom, nothing else), and what the package is *not* (a server plugin —
 * no Nest, no Drizzle, no pool). Each is one line to break by accident and none
 * of them shows up in a type error, because the workspace resolves this package
 * from source and never exercises its `exports` map at all.
 */
// `vite.config.mts` sets `root: __dirname`, so this is the package directory.
// A wrong answer is not silent: the name assertion below is the first test.
const packageRoot = process.cwd();

type Manifest = {
    name: string;
    main?: string;
    types?: string;
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

const manifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
) as Manifest;

const dependencyNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
];

describe('@orthacms/design-system package manifest', () => {
    it('is the package it claims to be', () => {
        expect(manifest.name).toBe('@orthacms/design-system');
    });

    it('publishes one root entry plus the stylesheet, and no other subpath [design-system:I-02]', () => {
        // Exact, not `toContain`: the failure this guards is a *new* subpath —
        // `./ui/*`, `./hooks`, a wildcard — quietly making an internal module
        // importable and therefore something the package has to keep stable.
        expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([
            '.',
            './package.json',
            './styles.css'
        ]);
    });

    it('points every root condition at src/index.ts, the single public surface [design-system:I-02]', () => {
        expect(manifest.exports?.['.']).toEqual({
            types: './src/index.ts',
            import: './src/index.ts',
            default: './src/index.ts'
        });
        expect(manifest.main).toBe('./src/index.ts');
        expect(manifest.types).toBe('./src/index.ts');
    });

    it('asks a consumer to install nothing beyond React 19 [design-system:I-38]', () => {
        expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual([
            'react',
            'react-dom'
        ]);
        for (const range of Object.values(manifest.peerDependencies ?? {})) {
            // `^19.x` and `^19.0.0` both satisfy the invariant; `>=18`, `*` or
            // a pinned `19.1.0` do not — each of those is a consumer's install
            // problem rather than a resolution the package made for them.
            expect(range).toMatch(/^\^19(\.|$)/);
        }
    });

    it('carries no i18n runtime, so nothing here has a catalogue to miss [design-system:I-06]', () => {
        expect(
            dependencyNames.filter((name) => /intl|i18n|lingui/i.test(name))
        ).toEqual([]);
    });

    it('depends on nothing server-side [design-system:I-37]', () => {
        const serverSide = dependencyNames.filter((name) =>
            /^@nestjs\/|^drizzle|^pg$|^express$|^@orthacms\/(database|.*-server)$/.test(
                name
            )
        );
        expect(serverSide).toEqual([]);
    });

    it('ships no migration tooling, so it owns no tables [design-system:I-37]', () => {
        expect(existsSync(join(packageRoot, 'drizzle.config.ts'))).toBe(false);
        expect(existsSync(join(packageRoot, 'migrations'))).toBe(false);
    });
});
