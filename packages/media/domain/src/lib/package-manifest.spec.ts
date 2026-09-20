import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The storage port's zero-dependency rule, asserted rather than reviewed.
 *
 * Seven adapter packages — local, memory, s3, gcs, azure, vercel-blob and the
 * testkit — depend on this one to speak the port, and so does the server that
 * hosts them. A single dependency added here is inherited by all of them, which
 * is precisely how this package came to exist: the port's error class lived
 * behind `@orthacms/media-server`, so `npm i @orthacms/media-provider-s3`
 * installed NestJS, Drizzle, Express and Sharp to talk to a bucket.
 *
 * The manifest is the only half of that a consumer reads before any code runs,
 * so it is the half to check here. The require graph — the other way the
 * framework got in, through a barrel — is checked in
 * `provider-testkit/src/lib/adapter-packages.spec.ts`.
 */
describe('@orthacms/media-domain package manifest', () => {
    const manifest = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };

    it('is the package it claims to be', () => {
        expect(manifest.name).toBe('@orthacms/media-domain');
    });

    it.each(['dependencies', 'peerDependencies', 'devDependencies'] as const)(
        // covers: media:I-34
        'declares no %s, so no adapter inherits one from the port',
        (field) => {
            expect(Object.keys(manifest[field] ?? {})).toEqual([]);
        }
    );
});
