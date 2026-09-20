import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The SSO seam's zero-dependency rule, asserted rather than reviewed.
 *
 * Every adapter package — OIDC, SAML, GitHub, and whatever a deployment writes
 * itself — depends on this one to speak the port. A single dependency added
 * here is inherited by all of them and by the server that hosts them, which is
 * how a "framework-free kernel" quietly stops being one. The manifest is the
 * only place that can be checked without a build, so it is the place to check.
 */
describe('@orthacms/identity-domain package manifest', () => {
    const manifest = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };

    it('is the package it claims to be', () => {
        expect(manifest.name).toBe('@orthacms/identity-domain');
    });

    it.each(['dependencies', 'peerDependencies'] as const)(
        // covers: identity:I-27
        'declares no %s, so no adapter inherits one from the port',
        (field) => {
            expect(Object.keys(manifest[field] ?? {})).toEqual([]);
        }
    );
});
