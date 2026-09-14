import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplate, type TemplateValues } from './template';

/**
 * The generated app's `config/` modules, **executed**.
 *
 * Everything else about the template can be checked by reading the rendered
 * text; this cannot. "An empty key means no item in the list" is a runtime
 * decision, and a grep for the `if` that makes it would pass on an `if` whose
 * condition had been inverted.
 *
 * They are cheap to run because of how they are written: each imports its
 * provider package for a *type* — erased — plus the env readers from
 * `@apograph/utils-server`, so nothing here loads a vendor SDK or a Nest
 * module. The app is rendered inside this package so that `@apograph/*`
 * resolves from the workspace the way it will resolve from the generated app's
 * own `node_modules`.
 */

const TEMPLATE = join(__dirname, '../../templates/default');

const values = (...ids: string[]): TemplateValues => ({
    appName: 'my-cms',
    appTitle: 'My CMS',
    databaseUrl: 'postgresql://apograph:apograph@localhost:5432/my_cms',
    databaseName: 'my_cms',
    adminEmail: 'admin@example.com',
    adminPassword: 'hunter2',
    apographVersion: '9.9.9',
    selection: { enabled: new Set(ids) }
});

let target: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
    // Dot-prefixed and inside the package: `node_modules` resolution has to
    // walk up to this workspace, which a system temp directory cannot do.
    target = mkdtempSync(join(__dirname, '../../.rendered-'));
    env = { ...process.env };
});

afterEach(() => {
    process.env = env;
    rmSync(target, { recursive: true, force: true });
    jest.resetModules();
});

/** Renders the app and loads one of its modules. */
function load<T>(ids: string[], path: string): T {
    renderTemplate(TEMPLATE, target, values(...ids));
    return require(join(target, path)) as T;
}

describe('a copilot backend', () => {
    /** Renders with Claude selected and reads its builder back. */
    function anthropicProvider(): () => unknown {
        return load<{ anthropicProvider: () => unknown }>(
            ['media-local', 'rest', 'copilot-anthropic'],
            'apps/server/config/copilot-anthropic'
        ).anthropicProvider;
    }

    /**
     * Setting the key is what *registers* the backend. An unconfigured provider
     * that registered anyway would be the first entry in the list — the one a
     * run naming no provider gets — and would fail on the user's first message,
     * with an authentication error that reads as an Apograph bug.
     */
    it('is absent from the config when its key is unset [create-apograph-app:I-16]', () => {
        delete process.env['ANTHROPIC_API_KEY'];

        expect(anthropicProvider()()).toBeUndefined();
    });

    it('is absent when the key is set but empty [create-apograph-app:I-16]', () => {
        process.env['ANTHROPIC_API_KEY'] = '';

        expect(anthropicProvider()()).toBeUndefined();
    });

    it('is present once its key is set [create-apograph-app:I-16]', () => {
        process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';

        expect(anthropicProvider()()).toMatchObject({ apiKey: 'sk-ant-test' });
    });
});

describe('an SSO provider', () => {
    /** Renders with OIDC selected and reads its builder back. */
    function oidcProvider(): () => unknown {
        return load<{ oidcProvider: () => unknown }>(
            ['media-local', 'rest', 'sso-oidc'],
            'apps/server/config/sso-oidc'
        ).oidcProvider;
    }

    /**
     * Both halves are needed, and a half-configured provider is the dangerous
     * case: it becomes a sign-in button that can only fail, and every SSO
     * failure looks the same, so whoever clicks it learns nothing.
     */
    it.each([
        ['neither value', {}],
        [
            'an issuer with no client id',
            { SSO_OIDC_ISSUER: 'https://issuer.test' }
        ],
        ['a client id with no issuer', { SSO_OIDC_CLIENT_ID: 'client' }]
    ])(
        'is absent from the config with %s [create-apograph-app:I-16]',
        (_label, settings) => {
            delete process.env['SSO_OIDC_ISSUER'];
            delete process.env['SSO_OIDC_CLIENT_ID'];
            Object.assign(process.env, settings);

            expect(oidcProvider()()).toBeUndefined();
        }
    );

    it('is present once both are set [create-apograph-app:I-16]', () => {
        process.env['SSO_OIDC_ISSUER'] = 'https://issuer.test';
        process.env['SSO_OIDC_CLIENT_ID'] = 'client';

        expect(oidcProvider()()).toMatchObject({
            name: 'oidc',
            issuer: 'https://issuer.test',
            clientId: 'client'
        });
    });
});

/**
 * The two providers whose whole wiring was missing.
 *
 * The wizard offered GitHub and SAML from the start, and choosing either added
 * a package to `package.json` and nothing else — no config module, no keys in
 * `.env`, no registration. So the rule these share with OIDC ("present only
 * when its settings are") had never been true of them in either direction, and
 * a test that only covered OIDC could not say so.
 */
describe('the GitHub provider', () => {
    /** Renders with GitHub selected and reads its builder back. */
    function githubProvider(): () => unknown {
        return load<{ githubProvider: () => unknown }>(
            ['media-local', 'rest', 'sso-github'],
            'apps/server/config/sso-github'
        ).githubProvider;
    }

    beforeEach(() => {
        delete process.env['SSO_GITHUB_CLIENT_ID'];
        delete process.env['SSO_GITHUB_CLIENT_SECRET'];
        delete process.env['SSO_GITHUB_SCOPES'];
    });

    /**
     * The secret is not optional the way an OIDC one is: GitHub's code
     * exchange has no PKCE, so the secret is the only thing proving the code
     * is being redeemed by this application. Half-configured, the adapter
     * throws at construction — which is a boot failure rather than a sign-in
     * button that fails silently, and either way not what the operator wanted.
     */
    it.each([
        ['neither value', {}],
        ['a client id with no secret', { SSO_GITHUB_CLIENT_ID: 'abc' }],
        ['a secret with no client id', { SSO_GITHUB_CLIENT_SECRET: 'shh' }]
    ])(
        'is absent from the config with %s [create-apograph-app:I-16]',
        (_label, settings) => {
            Object.assign(process.env, settings);

            expect(githubProvider()()).toBeUndefined();
        }
    );

    it('is present once both are set [create-apograph-app:I-16]', () => {
        process.env['SSO_GITHUB_CLIENT_ID'] = 'abc';
        process.env['SSO_GITHUB_CLIENT_SECRET'] = 'shh';

        expect(githubProvider()()).toMatchObject({
            name: 'github',
            clientId: 'abc',
            clientSecret: 'shh'
        });
    });

    /**
     * `readList` answers a blank line with `[]`, and `[]` is a value: passed
     * through, the adapter's `scopes ?? DEFAULT_SCOPES` keeps it and the app
     * requests *no* scopes — so the token comes back unable to read the
     * profile the sign-in exists to read. The `.env` ships this key blank, so
     * that is the default state of a fresh app rather than a mistake.
     */
    it('leaves the scopes at the adapter’s default rather than requesting none', () => {
        process.env['SSO_GITHUB_CLIENT_ID'] = 'abc';
        process.env['SSO_GITHUB_CLIENT_SECRET'] = 'shh';
        process.env['SSO_GITHUB_SCOPES'] = '';

        expect(githubProvider()()).not.toHaveProperty('scopes');
    });

    it('passes the scopes through when the operator names some', () => {
        process.env['SSO_GITHUB_CLIENT_ID'] = 'abc';
        process.env['SSO_GITHUB_CLIENT_SECRET'] = 'shh';
        process.env['SSO_GITHUB_SCOPES'] = 'read:user, user:email';

        expect(githubProvider()()).toMatchObject({
            scopes: ['read:user', 'user:email']
        });
    });
});

describe('the SAML provider', () => {
    /** Renders with SAML selected and reads its builder back. */
    function samlProvider(): () => unknown {
        return load<{ samlProvider: () => unknown }>(
            ['media-local', 'rest', 'sso-saml'],
            'apps/server/config/sso-saml'
        ).samlProvider;
    }

    const CONFIGURED = {
        SSO_SAML_ENTRY_POINT: 'https://idp.test/sso',
        SSO_SAML_IDP_CERT: 'MIICertificate',
        SSO_SAML_ISSUER: 'urn:my-cms'
    };

    beforeEach(() => {
        for (const key of Object.keys(CONFIGURED)) delete process.env[key];
    });

    /**
     * All three are required and none has a fallback: SAML has no discovery
     * document and no key endpoint, so the certificate is the whole of the
     * trust relationship.
     */
    it.each(Object.keys(CONFIGURED))(
        'is absent from the config without %s [create-apograph-app:I-16]',
        (missing) => {
            Object.assign(process.env, CONFIGURED);
            delete process.env[missing];

            expect(samlProvider()()).toBeUndefined();
        }
    );

    it('is present once all three are set [create-apograph-app:I-16]', () => {
        Object.assign(process.env, CONFIGURED);

        expect(samlProvider()()).toMatchObject({
            name: 'saml',
            entryPoint: 'https://idp.test/sso',
            issuer: 'urn:my-cms'
        });
    });

    /**
     * An environment variable cannot hold a real newline, so a PEM pasted into
     * `.env` arrives as one line of `\n` escapes. Left as they are, the XML
     * signature check fails on a certificate that looks correct in the file.
     */
    it('puts the certificate’s newlines back', () => {
        Object.assign(process.env, CONFIGURED);
        process.env['SSO_SAML_IDP_CERT'] =
            '-----BEGIN CERTIFICATE-----\\nMIIC\\n-----END CERTIFICATE-----';

        expect(samlProvider()()).toMatchObject({
            idpCert:
                '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----'
        });
    });

    /**
     * SAML carries no verification claim at all, so this can only ever be an
     * operator's assertion — and it is the only gate on a first sign-in
     * claiming an existing account. It must not default to true, and a blank
     * line in `.env` must not read as one.
     */
    it.each([
        ['unset', undefined],
        ['blank', ''],
        ['false', 'false']
    ])(
        'treats an email-verified flag that is %s as not verified',
        (_label, value) => {
            Object.assign(process.env, CONFIGURED);
            if (value === undefined) {
                delete process.env['SSO_SAML_EMAIL_VERIFIED'];
            } else {
                process.env['SSO_SAML_EMAIL_VERIFIED'] = value;
            }

            expect(samlProvider()()).toMatchObject({ emailVerified: false });
        }
    );
});

/**
 * Mail, whose "unset" answer is a whole configuration rather than a missing
 * value.
 *
 * Every other builder here answers "is this backend configured?" with a
 * provider or `undefined` inside a config that exists either way. This one
 * returns `undefined` for the config itself, and that is what a freshly
 * scaffolded app runs: no plugin, no queue, no worker, and the invite route
 * still handing the link back. Inverting the check would make a keyless app
 * refuse to boot — `APP_URL` and `MAIL_FROM` are required the moment a backend
 * is named — which is a scaffolder that generates an app that cannot start.
 */
describe('mail', () => {
    /** Renders with SMTP selected and reads its builder back. */
    function mailConfig(): () => unknown {
        return load<{ mailConfig: () => unknown }>(
            ['media-local', 'rest', 'mail-smtp'],
            'apps/server/config/mail'
        ).mailConfig;
    }

    const CONFIGURED = {
        MAIL_PROVIDER: 'smtp',
        APP_URL: 'https://cms.example.test',
        MAIL_FROM: 'My CMS <no-reply@example.test>',
        SMTP_HOST: 'smtp.example.test'
    };

    beforeEach(() => {
        for (const key of Object.keys(CONFIGURED)) delete process.env[key];
    });

    it.each([
        ['unset', undefined],
        ['blank', '']
    ])(
        'sends nothing when MAIL_PROVIDER is %s [create-apograph-app:I-35]',
        (_label, value) => {
            if (value !== undefined) process.env['MAIL_PROVIDER'] = value;

            expect(mailConfig()()).toBeUndefined();
        }
    );

    /**
     * A misspelling must not read as "send nothing". Silently sending nothing
     * is the failure the whole arrangement is built to avoid, and it would show
     * up as invitations nobody receives rather than as a boot error.
     */
    it('refuses a backend it was not scaffolded with', () => {
        process.env['MAIL_PROVIDER'] = 'console';

        expect(() => mailConfig()()).toThrow(/MAIL_PROVIDER/);
    });

    /**
     * Both are required the moment a backend is named, and `requireEnv` is what
     * says so at boot rather than on somebody's first invitation: a message
     * with no sender is refused by every relay, and every link in it is built
     * from `APP_URL`.
     */
    it.each(['APP_URL', 'MAIL_FROM', 'SMTP_HOST'])(
        'refuses to boot with a backend named and no %s',
        (missing) => {
            Object.assign(process.env, CONFIGURED);
            delete process.env[missing];

            expect(() => mailConfig()()).toThrow(new RegExp(missing));
        }
    );

    it('builds the relay settings once a backend is named [create-apograph-app:I-35]', () => {
        Object.assign(process.env, CONFIGURED);

        expect(mailConfig()()).toMatchObject({
            backend: 'smtp',
            appUrl: 'https://cms.example.test',
            from: 'My CMS <no-reply@example.test>',
            smtp: { host: 'smtp.example.test' }
        });
    });

    /**
     * `.env` ships `SMTP_SECURE=` blank, and blank is not `false` here: passing
     * `false` turns implicit TLS off explicitly, where leaving the key out lets
     * the adapter upgrade the connection with STARTTLS — which is what port 587
     * wants. The two look identical in the file and behave differently on the
     * wire.
     */
    it('leaves implicit TLS unset rather than switching it off', () => {
        Object.assign(process.env, CONFIGURED);
        process.env['SMTP_SECURE'] = '';

        expect(mailConfig()()).toMatchObject({
            smtp: expect.not.objectContaining({ secure: expect.anything() })
        });
    });
});

/**
 * A key the generated `.env` ships blank.
 *
 * `env.tmpl` writes twenty-odd keys with nothing on the right-hand side —
 * that is how an operator finds out a setting exists — so "present but empty"
 * is the *default* state of a fresh app, not a mistake somebody has to make.
 * `??` falls back on `undefined`, never on `''`, so a raw
 * `process.env['X'] ?? default` in `config/` lets an untouched line beat the
 * default it was there to fall back to. These load the rendered modules and
 * pass the blank in.
 */
describe('a setting written into .env with no value', () => {
    it('leaves the OIDC provider name at its default rather than naming it ""', () => {
        // Registered under `''`, the provider's callback is
        // `/api/auth/sso//callback`, and nothing reports it at boot.
        process.env['SSO_OIDC_ISSUER'] = 'https://issuer.test';
        process.env['SSO_OIDC_CLIENT_ID'] = 'client';
        process.env['SSO_OIDC_NAME'] = '';

        expect(
            load<{ oidcProvider: () => { name: string } | undefined }>(
                ['media-local', 'rest', 'sso-oidc'],
                'apps/server/config/sso-oidc'
            ).oidcProvider()
        ).toMatchObject({ name: 'oidc' });
    });

    it('keeps the default upload root rather than writing blobs to ""', () => {
        process.env['MEDIA_LOCAL_ROOT'] = '';

        expect(
            load<{ mediaStorage: () => { rootDir: string } }>(
                ['media-local', 'rest'],
                'apps/server/config/media-storage'
            ).mediaStorage()
        ).toEqual({ rootDir: './.storage/media' });
    });

    it('keeps the default S3 region rather than signing for region ""', () => {
        // R2 rejects a request signed for the empty region, and the AWS SDK
        // builds an endpoint from it — neither failure names the variable.
        process.env['MEDIA_S3_BUCKET'] = 'uploads';
        process.env['MEDIA_S3_REGION'] = '';

        expect(
            load<{ mediaStorage: () => { region: string } }>(
                ['media-s3', 'rest'],
                'apps/server/config/media-storage'
            ).mediaStorage()
        ).toMatchObject({ region: 'auto' });
    });

    it('refuses a root administrator password made of spaces', () => {
        // Untrimmed, `'   '` passed identity's own `if (!password)` guard and
        // became the administrator's actual password.
        process.env['APOGRAPH_ROOT_ADMIN_EMAIL'] = 'admin@example.test';
        process.env['APOGRAPH_ROOT_ADMIN_PASSWORD'] = '   ';

        expect(
            load<{
                identityConfig: () => { rootAdmin: { password: string } };
            }>(
                ['media-local', 'rest'],
                'apps/server/config/identity'
            ).identityConfig().rootAdmin.password
        ).toBe('');
    });
});

/**
 * The webhook URL policy.
 *
 * These two flags decide where this server can be talked into connecting, and
 * both default to **off** because a webhook is the server making a request to
 * an address a user typed — the shape of every SSRF. The reason they are pinned
 * here rather than trusted to the plugin is that they were **documented in
 * `.env` and read by nothing** for several releases: `config/webhooks.ts` did
 * not exist and `WebhooksPlugin()` took no argument, so an operator who set
 * `WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` to reach an in-cluster receiver got the
 * default anyway, silently.
 *
 * So the assertion is deliberately end-to-end for a config module: the value in
 * the environment has to come out of the builder. A default that is merely
 * correct proves nothing here — the broken version had correct defaults too.
 */
describe('the webhook URL policy', () => {
    /** Renders a default app and reads the webhooks builder back. */
    function webhooksConfig(): () => {
        allowInsecureUrls?: boolean;
        allowPrivateNetworks?: boolean;
        retentionDays?: number;
    } {
        return load<{ webhooksConfig: () => never }>(
            ['media-local', 'rest'],
            'apps/server/config/webhooks'
        ).webhooksConfig;
    }

    it('refuses plain HTTP and private networks by default', () => {
        delete process.env['WEBHOOKS_ALLOW_INSECURE_URLS'];
        delete process.env['WEBHOOKS_ALLOW_PRIVATE_NETWORKS'];

        expect(webhooksConfig()()).toMatchObject({
            allowInsecureUrls: false,
            allowPrivateNetworks: false
        });
    });

    it('lets the environment widen it, which is the whole point [create-apograph-app:I-34]', () => {
        process.env['WEBHOOKS_ALLOW_INSECURE_URLS'] = 'true';
        process.env['WEBHOOKS_ALLOW_PRIVATE_NETWORKS'] = 'true';
        process.env['WEBHOOKS_RETENTION_DAYS'] = '7';

        expect(webhooksConfig()()).toMatchObject({
            allowInsecureUrls: true,
            allowPrivateNetworks: true,
            retentionDays: 7
        });
    });
});
