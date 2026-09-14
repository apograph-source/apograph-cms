import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The mail port's zero-dependency rule, asserted rather than reviewed.
 *
 * Three adapter packages speak this port today — smtp, console and testkit —
 * and `users-server` imports it purely for the dispatcher token it injects
 * optionally. A dependency added here is inherited by all of them, and the one
 * that would hurt most is the framework: the whole point of a separate kernel
 * is that `npm i @apograph/mail-provider-smtp` installs an SMTP client, not
 * NestJS and Drizzle. `@apograph/media-domain` holds the same line for the same
 * reason.
 */
describe('@apograph/mail-domain package manifest', () => {
    const manifest = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };

    it('is the package it claims to be', () => {
        expect(manifest.name).toBe('@apograph/mail-domain');
    });

    it.each(['dependencies', 'peerDependencies', 'devDependencies'] as const)(
        'declares no %s, so no adapter inherits one from the port',
        (field) => {
            expect(Object.keys(manifest[field] ?? {})).toEqual([]);
        }
    );
});
