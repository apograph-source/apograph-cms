import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrthaConfig } from '../ortha.config';

/**
 * The host config, exercised through the real module.
 *
 * Every value here is read at **import** time from `process.env`, so the only
 * honest way to test it is to set the environment and re-import — which is what
 * `loadConfig` below does. The alternative (a second copy of the reading logic
 * in a spec) is the shape that let `apps/server-e2e` stay green through four of
 * the five findings on `bootstrap-server`: it asserted a mirror of the
 * bootstrap rather than the bootstrap.
 *
 * The claims are worth pinning because the failure mode of this file is silence.
 * `Number(process.env[x]) || default` accepted a negative and swallowed a zero,
 * and `NODE_ENV !== 'production'` reads a misspelling as "not production" —
 * neither is visible from the outside until a session expires on arrival or a
 * cookie ships without `Secure`.
 *
 * Lives under `src/` because that is what `tsconfig.spec.json` compiles; the
 * module under test is one level up.
 */

/** Reloads `ortha.config` with `env` applied over the ambient environment. */
function loadConfig(env: Record<string, string | undefined>): OrthaConfig {
    const saved = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        let loaded: OrthaConfig | undefined;
        jest.isolateModules(() => {
            loaded = require('../ortha.config').default as OrthaConfig;
        });
        return loaded as OrthaConfig;
    } finally {
        process.env = saved;
    }
}

/** Loads with `env` applied and returns the thrown error's message, or `null`. */
function loadError(env: Record<string, string | undefined>): string | null {
    try {
        loadConfig(env);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

describe('required deploy values', () => {
    it('refuses to load without DATABASE_URL, naming the variable', () => {
        const message = loadError({ DATABASE_URL: undefined });
        expect(message).toContain('DATABASE_URL');
    });

    it('treats an empty DATABASE_URL as missing rather than as a connection string', () => {
        // `pg` reads `''` as "use the libpq defaults", so this used to boot and
        // then fail inside identity's role seeder on an error about SASL.
        expect(loadError({ DATABASE_URL: '   ' })).toContain('DATABASE_URL');
    });
});

describe('numeric settings', () => {
    it('falls back to the default when unset or empty', () => {
        // `.env.example` ships several keys with no value on the right-hand side,
        // so empty has to mean "not configured", not "configured badly".
        expect(
            loadConfig({ SESSION_TTL_SECONDS: undefined }).plugins.identity
                .session.ttlSeconds
        ).toBe(60 * 60 * 24 * 7);
        expect(
            loadConfig({ SESSION_TTL_SECONDS: '' }).plugins.identity.session
                .ttlSeconds
        ).toBe(60 * 60 * 24 * 7);
    });

    it('reads a plain positive integer', () => {
        expect(
            loadConfig({ SESSION_TTL_SECONDS: '3600' }).plugins.identity.session
                .ttlSeconds
        ).toBe(3600);
    });

    it('rejects a negative value instead of accepting it', () => {
        // Measured before this check existed: `SESSION_TTL_SECONDS=-1` boots,
        // login answers `201` with `Max-Age=-1`, and the next request is `401` —
        // an instance where nobody can stay signed in and nothing says why.
        expect(loadError({ SESSION_TTL_SECONDS: '-1' })).toContain(
            'SESSION_TTL_SECONDS'
        );
        expect(loadError({ MEDIA_MAX_UPLOAD_BYTES: '-1' })).toContain(
            'positive whole number'
        );
    });

    it('rejects zero instead of silently substituting the default', () => {
        // `LOGIN_RATE_LIMIT=0` reads as "allow no logins" and used to mean 10.
        expect(loadError({ LOGIN_RATE_LIMIT: '0' })).toContain(
            'LOGIN_RATE_LIMIT'
        );
    });

    it('keeps a documented zero off-switch loadable [database:I-23]', () => {
        // `OUTBOX_RETENTION_DAYS=0` is documented as "never prune" in
        // `.env.example`, the scaffolder's `env.tmpl`, this file's comment and
        // `OrthaDatabaseConfig`. Read through `readPositiveInt` it threw, so
        // the documented way to switch retention off made the server refuse to
        // start — the value has to arrive at the plugin as `0`, which is the
        // form `pruneIfDue` reads as "never".
        expect(
            loadConfig({ OUTBOX_RETENTION_DAYS: '0' }).database
                .outboxRetentionDays
        ).toBe(0);
        expect(
            loadConfig({ OUTBOX_RETENTION_DAYS: '7' }).database
                .outboxRetentionDays
        ).toBe(7);
        expect(
            loadConfig({ OUTBOX_RETENTION_DAYS: undefined }).database
                .outboxRetentionDays
        ).toBe(30);
        // Zero is the only thing that moved: a negative is still a refusal,
        // because it is a typo rather than an off-switch.
        expect(loadError({ OUTBOX_RETENTION_DAYS: '-1' })).toContain(
            'OUTBOX_RETENTION_DAYS'
        );
    });

    it('rejects exponent notation, which quietly removed the GraphQL cost budget', () => {
        // `Number('1e9')` is a finite integer, so `GRAPHQL_MAX_DEPTH=1e9` passed
        // every check and deleted the bound ADR-0008 relies on in place of the
        // structural one REST gave for free.
        expect(loadError({ GRAPHQL_MAX_DEPTH: '1e9' })).toContain(
            'GRAPHQL_MAX_DEPTH'
        );
    });

    it('rejects a non-numeric value', () => {
        expect(loadError({ PORT: 'eight-thousand' })).toContain('PORT');
    });
});

describe('NODE_ENV', () => {
    it('publishes the API reference and omits Secure when unset (local development)', () => {
        const config = loadConfig({ NODE_ENV: undefined, API_DOCS: undefined });
        expect(config.docs.enabled).toBe(true);
        expect(config.plugins.identity.session.cookieSecure).toBe(false);
    });

    it('withholds the reference and sets Secure in production', () => {
        const config = loadConfig({
            NODE_ENV: 'production',
            API_DOCS: undefined
        });
        expect(config.docs.enabled).toBe(false);
        expect(config.plugins.identity.session.cookieSecure).toBe(true);
    });

    it('refuses a misspelling rather than reading it as "not production"', () => {
        // The whole of ORT-137 in one line: `produciton` served
        // `/reference/json` unauthenticated *and* dropped `Secure` from the
        // session cookie, indistinguishable from a correct configuration until
        // someone read a response header.
        const message = loadError({ NODE_ENV: 'produciton' });
        expect(message).toContain('produciton');
        expect(message).toContain('production');
    });

    it('lets API_DOCS override in both directions', () => {
        expect(
            loadConfig({ NODE_ENV: 'production', API_DOCS: 'true' }).docs
                .enabled
        ).toBe(true);
        expect(
            loadConfig({ NODE_ENV: undefined, API_DOCS: 'false' }).docs.enabled
        ).toBe(false);
        // Fail-closed on any other spelling, which is the right way round.
        expect(
            loadConfig({ NODE_ENV: undefined, API_DOCS: 'TRUE' }).docs.enabled
        ).toBe(false);
    });
});

describe('copilot run ceilings', () => {
    const unset = {
        COPILOT_MAX_STEPS: undefined,
        COPILOT_WALL_CLOCK_MS: undefined,
        COPILOT_MAX_TOTAL_TOKENS: undefined
    };

    it('omits `limits` entirely when none are set', () => {
        // Spreading `limits: { maxSteps: undefined }` would overwrite the
        // plugin's own ceiling with nothing, so each key is conditional — and
        // so is the object, or an untouched `.env` would pin `limits: {}` here
        // instead of leaving DEFAULT_RUN_LIMITS visible.
        expect(loadConfig(unset).plugins.copilot.limits).toBeUndefined();
        expect(
            loadConfig({
                ...unset,
                COPILOT_MAX_STEPS: '',
                COPILOT_WALL_CLOCK_MS: '',
                COPILOT_MAX_TOTAL_TOKENS: ''
            }).plugins.copilot.limits
        ).toBeUndefined();
    });

    it('passes each configured ceiling through on its own', () => {
        expect(
            loadConfig({ ...unset, COPILOT_MAX_STEPS: '20' }).plugins.copilot
                .limits
        ).toEqual({ maxSteps: 20 });
        expect(
            loadConfig({ ...unset, COPILOT_WALL_CLOCK_MS: '600000' }).plugins
                .copilot.limits
        ).toEqual({ wallClockMs: 600_000 });
        expect(
            loadConfig({ ...unset, COPILOT_MAX_TOTAL_TOKENS: '900000' }).plugins
                .copilot.limits
        ).toEqual({ maxTotalTokens: 900_000 });
    });

    it('carries a partial override without inventing the other two', () => {
        // The point of the conditional keys: raising one must not silently pin
        // the other two to whatever this file happened to think they were.
        expect(
            loadConfig({
                ...unset,
                COPILOT_MAX_STEPS: '50',
                COPILOT_MAX_TOTAL_TOKENS: '900000'
            }).plugins.copilot.limits
        ).toEqual({ maxSteps: 50, maxTotalTokens: 900_000 });
    });

    it('rejects zero, which would make every run end before its first step', () => {
        expect(loadError({ ...unset, COPILOT_MAX_STEPS: '0' })).toContain(
            'COPILOT_MAX_STEPS'
        );
        expect(loadError({ ...unset, COPILOT_WALL_CLOCK_MS: '0' })).toContain(
            'COPILOT_WALL_CLOCK_MS'
        );
        expect(
            loadError({ ...unset, COPILOT_MAX_TOTAL_TOKENS: '0' })
        ).toContain('COPILOT_MAX_TOTAL_TOKENS');
    });
});

describe('ALLOWED_ORIGINS', () => {
    it('trims and drops empties', () => {
        expect(
            loadConfig({
                ALLOWED_ORIGINS: ' http://a.test , ,http://b.test '
            }).plugins.identity.allowedOrigins
        ).toEqual(['http://a.test', 'http://b.test']);
    });

    it('follows ADMIN_PORT when unset, so a parallel worktree stack is not rejected', () => {
        expect(
            loadConfig({ ALLOWED_ORIGINS: undefined, ADMIN_PORT: '4207' })
                .plugins.identity.allowedOrigins
        ).toEqual(['http://localhost:4207']);
    });

    it('yields an empty list when set to empty, refusing every browser origin', () => {
        // Fail-closed, and worth pinning as deliberate: an operator who blanks
        // the variable locks the admin out of every state-changing request
        // (measured: `403` from the OriginGuard on login), with a `.env` that
        // looks configured.
        expect(
            loadConfig({ ALLOWED_ORIGINS: '' }).plugins.identity.allowedOrigins
        ).toEqual([]);
    });
});

/**
 * Which model backends this deployment even has.
 *
 * There is no `COPILOT_PROVIDER` naming one of them any more: the registered
 * list is the setting and its first entry serves a run that names none, so a
 * backend nobody configured must not be in the list at all — registered, it
 * would be the house default and would fail on the first message.
 */
describe('copilot provider registration', () => {
    const unset = {
        ANTHROPIC_API_KEY: undefined,
        COPILOT_OPENAI_BASE_URL: undefined
    };

    it('registers neither hosted backend in a clone with no keys', () => {
        // Which leaves the catalogue empty: `plugins.ts` adds no scripted
        // fallback, so a keyless clone has no copilot at all. `COPILOT_ENABLED`
        // is off by default, so that boots; enabling it without configuring a
        // backend fails at construction instead.
        expect(loadConfig(unset).plugins.copilot.providers).toEqual({});
    });

    it('adds Claude when, and only when, a key is set', () => {
        const { claude } = loadConfig({
            ...unset,
            ANTHROPIC_API_KEY: 'sk-test',
            COPILOT_ANTHROPIC_MODELS: 'claude-opus-5, claude-haiku-4-5'
        }).plugins.copilot.providers;

        expect(claude?.apiKey).toBe('sk-test');
        expect(claude?.models).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
        // Blank is not "configured": a key that is only whitespace registers a
        // backend whose every call 401s.
        expect(
            loadConfig({ ...unset, ANTHROPIC_API_KEY: '   ' }).plugins.copilot
                .providers.claude
        ).toBeUndefined();
    });

    it('adds the OpenAI-wire backend only once an endpoint is named', () => {
        expect(
            loadConfig({ ...unset }).plugins.copilot.providers.ollama
        ).toBeUndefined();

        const { ollama } = loadConfig({
            ...unset,
            COPILOT_OPENAI_BASE_URL: 'http://localhost:11434/v1'
        }).plugins.copilot.providers;

        // No default endpoint: this used to fall back to a local Ollama, which
        // was harmless while a separate setting chose the provider and is not
        // now — it would put a backend nobody runs at the top of the list.
        expect(ollama?.baseUrl).toBe('http://localhost:11434/v1');
        expect(ollama?.models).toEqual(['llama3.1']);
    });
});

/**
 * A key that is present but blank.
 *
 * `.env.example` ships forty-two keys with nothing on the right-hand side and
 * the documented flow is to copy it to `.env`, so the state under test here is
 * not an edge case — it is what following the instructions produces. `??` falls
 * back on `undefined`, not on `''`, so every `process.env['X'] ?? default` in
 * this folder handed the blank line the win over the default it was meant to
 * fall back to. The readers in `@orthacms/utils-server` decide "empty means not
 * configured" once; these assert each site actually goes through them.
 *
 * Each case sets the *other* variables it needs, because `loadConfig` layers
 * over the ambient environment and this machine's `.env` is exactly the file
 * that carries the blanks.
 */
describe('a variable that is set but empty', () => {
    const oidc = {
        SSO_OIDC_ISSUER: 'https://issuer.test',
        SSO_OIDC_CLIENT_ID: 'client'
    };

    it('leaves the provider name at its default rather than naming it ""', () => {
        // The reported defect. A provider named `''` is registered under the
        // empty string, so its callback is `/api/auth/sso//callback` — and
        // nothing says so at boot, or ever.
        const { oidc: provider } = loadConfig({
            ...oidc,
            SSO_OIDC_NAME: ''
        }).plugins.identity.ssoProviders;

        expect(provider?.name).toBe('oidc');
    });

    it('honours a name that was actually set', () => {
        // The other half: "empty means absent" must not become "ignore it".
        expect(
            loadConfig({ ...oidc, SSO_OIDC_NAME: 'staff' }).plugins.identity
                .ssoProviders.oidc?.name
        ).toBe('staff');
    });

    it('lets SSO_PUBLIC_BASE_URL through a blank SSO_SAML_ISSUER', () => {
        // The worst of the set, because the blank was not merely losing its own
        // default — it was shadowing a value the operator *had* set, one `??`
        // to its right, and leaving the SAML entity id empty.
        const { saml } = loadConfig({
            SSO_SAML_ENTRY_POINT: 'https://idp.test/sso',
            SSO_SAML_IDP_CERT: 'CERT',
            SSO_SAML_ISSUER: '',
            SSO_PUBLIC_BASE_URL: 'https://cms.example.test'
        }).plugins.identity.ssoProviders;

        expect(saml?.issuer).toBe('https://cms.example.test');
    });

    it('provisions into the default role rather than a role named ""', () => {
        // A role named `''` matches no row in `roles`, so just-in-time
        // provisioning fails on the first sign-in it was configured for.
        expect(
            loadConfig({
                SSO_PROVISION_DOMAINS: 'example.test',
                SSO_PROVISION_ROLE: ''
            }).plugins.identity.sso?.provisioning?.defaultRole
        ).toBe('viewer');
    });

    it('keeps the default upload root rather than writing blobs to ""', () => {
        expect(
            loadConfig({ MEDIA_LOCAL_ROOT: '' }).plugins.media.storage.rootDir
        ).toBe('./.storage/media');
    });

    it('turns password login off for a value with a stray space', () => {
        // `'false ' !== 'false'` was true, so the switch failed *open*: an
        // operator who meant to require SSO kept password login enabled.
        expect(
            loadConfig({ SSO_ALLOW_PASSWORD_LOGIN: 'false ' }).plugins.identity
                .sso?.allowPasswordLogin
        ).toBe(false);
    });

    it('refuses a root administrator password made of spaces', () => {
        // Untrimmed, `'   '` passed identity's own `if (!password)` guard and
        // became the administrator's actual password.
        expect(
            loadConfig({
                ORTHA_ROOT_ADMIN_EMAIL: 'admin@example.test',
                ORTHA_ROOT_ADMIN_PASSWORD: '   '
            }).plugins.identity.rootAdmin?.password
        ).toBe('');
    });
});

/**
 * The rule that keeps the block above from being needed again.
 *
 * Every one of those defects was the same edit: someone needed a string with a
 * default, reached for `process.env['X'] ?? 'y'`, and skipped the one place
 * "empty means not configured" is decided. Nothing stopped them — the rule was
 * prose in `AGENTS.md` and a sentence in `ortha.config.ts`'s header. The
 * behavioural tests pin the six sites that were wrong; this pins the seventh
 * nobody has written yet.
 *
 * Deliberately a grep over source text rather than a check of values. There is
 * no runtime signal to assert on: a raw read and a `readEnv` read return the
 * same thing for every input except the blank one, which is exactly the input a
 * new site's author will not think to try.
 */
describe('config/ reads the environment only through the shared readers', () => {
    const CONFIG = join(__dirname, '../config');

    it.each(readdirSync(CONFIG).filter((name) => name.endsWith('.ts')))(
        'config/%s names no process.env of its own',
        (name) => {
            const source = readFileSync(join(CONFIG, name), 'utf8');
            // Comments may name it — the header of `env.ts` explains why the
            // derivation there is a constant — so this looks for a subscript,
            // which is the only shape a read takes in this folder.
            expect(source).not.toMatch(/process\.env\s*\[/);
        }
    );

    it('finds the modules it is meant to be checking', () => {
        // Without this the suite above passes on an empty folder, a renamed
        // directory, or a `.ts` filter that stopped matching.
        expect(
            readdirSync(CONFIG).filter((name) => name.endsWith('.ts')).length
        ).toBeGreaterThan(5);
    });
});
