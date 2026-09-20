import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
    ALL_FEATURES,
    COPILOT_PROVIDERS,
    MAIL_PROVIDERS,
    SSO_PROVIDERS,
    CORE_DEV_PACKAGES,
    CORE_PACKAGES,
    MEDIA_PROVIDERS,
    PROTOCOLS,
    TRANSITIVE_PACKAGES,
    resolveFlags,
    resolvePackages
} from './features';

const workspaceRoot = join(__dirname, '../../../..');

/** Every publishable `@orthacms/*` package name in the workspace. */
function publishedPackages(): string[] {
    const packagesDir = join(workspaceRoot, 'packages');
    const childDirs = (root: string): string[] =>
        readdirSync(root)
            .map((entry) => join(root, entry))
            .filter((entry) => statSync(entry).isDirectory());

    const names: string[] = [];

    for (const dir of [
        ...childDirs(packagesDir),
        ...childDirs(packagesDir).flatMap(childDirs)
    ]) {
        try {
            const manifest = JSON.parse(
                readFileSync(join(dir, 'package.json'), 'utf8')
            ) as { name?: string; private?: boolean };

            if (manifest.name?.startsWith('@orthacms/') && !manifest.private) {
                names.push(manifest.name);
            }
        } catch {
            // Not a package directory.
        }
    }

    return names;
}

/** A selection with the given feature ids enabled. */
function selectionOf(...ids: string[]) {
    return { enabled: new Set(ids) };
}

/**
 * The guard this file exists for.
 *
 * Adding a package to the workspace should force a decision about whether a
 * newly generated app gets it. Without this, the template simply falls a
 * release behind: the package publishes, nothing references it, and nobody
 * notices until a user asks why the feature they read about is missing.
 */
describe('every published package is accounted for', () => {
    const classified = new Set([
        ...CORE_PACKAGES,
        ...CORE_DEV_PACKAGES,
        ...TRANSITIVE_PACKAGES,
        ...ALL_FEATURES.flatMap((feature) => feature.packages)
    ]);

    // covers: create-ortha-app:I-01
    it.each(publishedPackages())('%s is classified', (name) => {
        // If this fails you added a package. Put it in one of `CORE_PACKAGES`,
        // a `Feature`'s `packages`, or `TRANSITIVE_PACKAGES` — whichever is
        // true — in `features.ts`.
        expect([...classified]).toContain(name);
    });

    it('classifies nothing that does not exist [create-ortha-app:I-02]', () => {
        const published = new Set(publishedPackages());
        const phantom = [...classified].filter(
            (name) => !published.has(name) && name !== '@orthacms/cli'
        );

        expect(phantom).toEqual([]);
    });

    it('puts no package in two groups at once [create-ortha-app:I-01]', () => {
        const all = [
            ...CORE_PACKAGES,
            ...TRANSITIVE_PACKAGES,
            ...ALL_FEATURES.flatMap((feature) => feature.packages)
        ];

        expect(all.length).toBe(new Set(all).size);
    });
});

describe('feature ids', () => {
    it('are unique', () => {
        const ids = ALL_FEATURES.map((feature) => feature.id);

        expect(ids.length).toBe(new Set(ids).size);
    });

    it('include REST, so the protocol answer reads as a complete set', () => {
        expect(PROTOCOLS.map((protocol) => protocol.id)).toContain('rest');
    });
});

describe('resolvePackages', () => {
    it('installs the core set with nothing enabled', () => {
        expect(resolvePackages(selectionOf())).toEqual([...CORE_PACKAGES]);
    });

    it('adds a feature’s packages when it is enabled', () => {
        expect(resolvePackages(selectionOf('graphql'))).toContain(
            '@orthacms/content-graphql'
        );
    });

    it('leaves them out when it is not', () => {
        expect(resolvePackages(selectionOf())).not.toContain(
            '@orthacms/content-graphql'
        );
    });

    /**
     * The copilot ships with every app. Its server half arrives anyway — five
     * core plugins depend on `copilot-server` to contribute their tools — so
     * leaving it undeclared bought nothing but a missing chat panel. Its
     * **backends** do not: each is an opt-in below, and there is no scripted
     * stand-in among them, so an app that picks none installs the plugin and
     * registers nothing.
     */
    it('installs the copilot with nothing enabled [create-ortha-app:I-14]', () => {
        const packages = resolvePackages(selectionOf());

        expect(packages).toEqual(
            expect.arrayContaining([
                '@orthacms/copilot-server',
                '@orthacms/copilot-admin'
            ])
        );
        expect(packages).not.toContain('@orthacms/copilot-provider-fake');
    });

    /**
     * Mail's split, which is the copilot's with one difference: the *plugin*
     * is opt-in here too. A deployment that sends nothing registers no queue
     * and no worker, so `mail-server` would be a package with nothing to do —
     * while the port stays declared, because that is what an operator
     * implements to reach a backend we ship no adapter for.
     */
    it('installs the mail port and the offline adapters in every app [create-ortha-app:I-35]', () => {
        const packages = resolvePackages(selectionOf());

        expect(packages).toEqual(
            expect.arrayContaining([
                '@orthacms/mail-domain',
                '@orthacms/mail-provider-console',
                '@orthacms/mail-provider-testkit'
            ])
        );
        expect(packages).not.toContain('@orthacms/mail-server');
        expect(packages).not.toContain('@orthacms/mail-provider-smtp');
    });

    it('adds the queue and the relay once a backend is chosen [create-ortha-app:I-35]', () => {
        expect(resolvePackages(selectionOf('mail-smtp'))).toEqual(
            expect.arrayContaining([
                '@orthacms/mail-server',
                '@orthacms/mail-provider-smtp'
            ])
        );
    });

    it('adds a model backend only when its provider is chosen', () => {
        expect(resolvePackages(selectionOf())).not.toContain(
            '@orthacms/copilot-provider-anthropic'
        );
        expect(resolvePackages(selectionOf('copilot-anthropic'))).toContain(
            '@orthacms/copilot-provider-anthropic'
        );
    });

    /**
     * These all arrive transitively, so an import resolves on npm's flat
     * `node_modules` whether or not they are declared. Declaring them is what
     * makes that resolution the app's own: an undeclared import breaks the
     * moment a version conflict nests a copy, and never resolves under pnpm.
     */
    it.each([
        '@orthacms/content-domain',
        '@orthacms/copilot-domain',
        '@orthacms/tools-server',
        '@orthacms/query-builder-admin'
    ])('declares %s, rather than relying on hoisting', (name) => {
        expect(resolvePackages(selectionOf())).toContain(name);
    });

    /**
     * The remaining opt-ins, in full. Anything else a published package could
     * be, a default app already has — so this list is also the answer to "what
     * does choosing nothing cost me?".
     */
    it('leaves exactly the choosable packages out of a default app', () => {
        const published = new Set(publishedPackages());
        const installed = new Set(resolvePackages(selectionOf('media-local')));
        const missing = [...published].filter(
            (name) =>
                !installed.has(name) &&
                name !== '@orthacms/cli' &&
                // Published, and deliberately never installed into an app —
                // tools for writing a storage provider, not for running one.
                !TRANSITIVE_PACKAGES.includes(name)
        );

        expect(missing.sort()).toEqual([
            '@orthacms/content-graphql',
            '@orthacms/copilot-provider-anthropic',
            '@orthacms/copilot-provider-openai',
            '@orthacms/identity-provider-github',
            '@orthacms/identity-provider-oidc',
            '@orthacms/identity-provider-saml',
            '@orthacms/mail-provider-smtp',
            '@orthacms/mail-server',
            '@orthacms/mcp-server',
            '@orthacms/media-provider-azure',
            '@orthacms/media-provider-gcs',
            '@orthacms/media-provider-s3',
            '@orthacms/media-provider-vercel-blob'
        ]);
    });

    it('does not install the S3 adapter unless it is chosen', () => {
        expect(resolvePackages(selectionOf('media-local'))).not.toContain(
            '@orthacms/media-provider-s3'
        );
    });

    it('adds nothing for REST, which needs no package of its own', () => {
        expect(resolvePackages(selectionOf('rest'))).toEqual([
            ...CORE_PACKAGES
        ]);
    });

    it('returns a sorted list with no duplicates', () => {
        const packages = resolvePackages(
            selectionOf('media-local', 'copilot-anthropic', 'copilot-openai')
        );

        expect(packages).toEqual([...packages].sort());
        expect(packages.length).toBe(new Set(packages).size);
    });
});

describe('resolveFlags', () => {
    it('is the picked ids, with nothing else derived', () => {
        expect(resolveFlags(selectionOf('mcp', 'copilot-openai'))).toEqual(
            new Set(['mcp', 'copilot-openai'])
        );
    });

    /**
     * The one derivation, and the reason for it: `ortha:if` is line-based with
     * no expression language, so a block cannot say "any of these three". The
     * three providers share one `ssoProviders` key, one builder in
     * `plugins.ts` and one extra argument to `IdentityPlugin`, and each has to
     * appear whichever of them was picked.
     */
    it.each(SSO_PROVIDERS.map((provider) => [provider.id] as const))(
        'derives the sso group flag from %s',
        (id) => {
            expect(resolveFlags(selectionOf(id)).has('sso')).toBe(true);
        }
    );

    /**
     * The same derivation one adapter earlier. `config/mail.ts`, the
     * `mailPlugin` helper, the `plugins.mail` field and the shared `MAIL_*`
     * keys belong to mail rather than to SMTP, and none of them may be left
     * behind as an empty husk in an app that configured no backend.
     */
    it.each(MAIL_PROVIDERS.map((provider) => [provider.id] as const))(
        'derives the mail group flag from %s',
        (id) => {
            expect(resolveFlags(selectionOf(id)).has('mail')).toBe(true);
        }
    );

    it('derives no mail flag for an app that picked no backend', () => {
        expect(
            resolveFlags(selectionOf('media-local', 'rest')).has('mail')
        ).toBe(false);
    });

    it('derives no sso flag for an app that picked no provider', () => {
        expect(
            resolveFlags(selectionOf('media-local', 'rest')).has('sso')
        ).toBe(false);
    });
});

describe('availability', () => {
    it('offers the S3 adapter, now that it is implemented', () => {
        // It was listed and disabled while `provider-s3` threw from every
        // method: offering it then would have generated an app that boots and
        // fails on the first upload.
        const s3 = MEDIA_PROVIDERS.find(
            (provider) => provider.id === 'media-s3'
        );

        expect(s3?.available).toBe(true);
    });

    it('leaves exactly one storage adapter selectable by default [create-ortha-app:I-12]', () => {
        const defaults = MEDIA_PROVIDERS.filter(
            (provider) => provider.enabledByDefault && provider.available
        );

        expect(defaults).toHaveLength(1);
    });

    /**
     * All three are off by default deliberately: an endpoint nobody asked for
     * is still an endpoint, a copilot provider sends content to a third party,
     * and single sign-on needs an issuer, a client and a callback URL
     * registered on the other side — none of which a scaffolder can invent.
     */
    it('starts every opt-in feature switched off [create-ortha-app:I-13]', () => {
        const optIn = [
            ...COPILOT_PROVIDERS,
            ...SSO_PROVIDERS,
            ...MAIL_PROVIDERS,
            ...PROTOCOLS.filter((protocol) => !protocol.locked)
        ];

        for (const feature of optIn) {
            expect(feature.enabledByDefault).toBe(false);
        }
    });

    /**
     * The console adapter writes a message to the log, which is exactly right
     * while developing and exactly wrong in production — an invitation that
     * looks sent and reaches nobody. It is installed with every app and
     * offered by nothing, the way `identity-provider-fake` is; the picker is
     * where the mistake would be made, so this is where it is refused.
     */
    it('offers no offline mail adapter in any picker [create-ortha-app:I-35]', () => {
        const offered = ALL_FEATURES.flatMap((feature) => feature.packages);

        expect(offered).not.toContain('@orthacms/mail-provider-console');
        expect(offered).not.toContain('@orthacms/mail-provider-testkit');
    });

    it('locks REST on, so it cannot be switched off', () => {
        const rest = PROTOCOLS.find((protocol) => protocol.id === 'rest');

        expect(rest?.locked).toBe(true);
        expect(rest?.enabledByDefault).toBe(true);
    });
});
