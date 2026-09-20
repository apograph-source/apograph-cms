/**
 * Reading `process.env` into typed configuration.
 *
 * A host's `apograph.config.ts` is the one file allowed to touch the environment,
 * and every deployment writes the same handful of readers to do it: a required
 * string, a bounded number, a comma list, `TRUST_PROXY`, `NODE_ENV`. They were
 * duplicated between this repo's host and the scaffolder's template, where the
 * copies had already drifted — the template's number reader had no
 * "optional, no default" form, so a generated app could not express a ceiling
 * that means "leave the plugin's own default alone".
 *
 * Every reader here **throws rather than guesses**. That is the whole point of
 * the module: the failure mode of environment parsing is silence, and a config
 * value that is quietly wrong is discovered a session TTL later, or by reading
 * a `Set-Cookie` header, rather than at boot with the variable named.
 *
 * The last two exports — {@link when} and {@link defined} — read nothing. They
 * are here because they are what a host does with the readers' `undefined`:
 * plugins merge their settings as `{ ...DEFAULTS, ...config }`, so an unset
 * value must become an *absent key* rather than an explicit `undefined`, which
 * would erase the default it was meant to leave alone. Every host writing that
 * as `...(x ? { key } : {})` at each call site is the duplication this module
 * exists to end.
 */

/**
 * A trimmed environment value, `undefined` when unset **or empty**.
 *
 * The one reader every other reader here is built on, so "empty means not
 * configured" is decided once. That equivalence matters: `.env.example` ships
 * keys with no value, and `ANTHROPIC_API_KEY=` has to leave a deployment with
 * *no* Claude backend rather than one registered with an empty key — a backend
 * that is in the picker and fails on the first message.
 */
export function readEnv(name: string): string | undefined {
    return process.env[name]?.trim() || undefined;
}

/**
 * Reads a value the app cannot run without, failing at load rather than
 * several seconds into boot.
 *
 * Left to default to `''`, a missing `DATABASE_URL` reaches `pg` as "use the
 * libpq defaults", and the first thing that touches the database fails with
 * whatever the local libpq environment happens to produce (measured: `SASL:
 * SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`). The server
 * does fail closed, which is the important half, but nothing in that message
 * names the variable that was never set.
 *
 * @param name The environment variable to read.
 * @param hint Appended to the error, for a deployment-specific instruction —
 *   which file to copy, which secret store to look in. Omitted, the message
 *   says only that there is no usable default.
 */
export function requireEnv(name: string, hint?: string): string {
    const raw = readEnv(name);
    if (!raw) {
        throw new Error(
            `Missing required environment variable ${name}. ` +
                (hint ?? 'The server has no usable default for this value.')
        );
    }
    return raw;
}

/**
 * Reads a numeric setting: the default when unset or empty, the value when it
 * is a plain positive decimal integer, and an error otherwise.
 *
 * This replaces `Number(process.env[x]) || default`, which was wrong in three
 * directions at once and silent in all of them. `0` is falsy, so it became the
 * default — `LOGIN_RATE_LIMIT=0` ("block every login") quietly meant 10. A
 * negative is truthy, so it was accepted — `SESSION_TTL_SECONDS=-1` issued
 * every session already expired, login answering `201` and the very next
 * request `401`. And exponent notation parsed, so `GRAPHQL_MAX_DEPTH=1e9`
 * removed the cost budget that ADR-0008 calls GraphQL's replacement for REST's
 * structural bound. Refusing to boot names the variable; the alternative was a
 * deployment that looked configured and was not.
 *
 * Empty is deliberately *not* an error: `.env.example` ships several keys with
 * no value, and a fresh clone must boot from it unchanged.
 */
export function readPositiveInt(name: string, fallback: number): number {
    return readOptionalPositiveInt(name) ?? fallback;
}

/**
 * As {@link readPositiveInt}, but `undefined` when unset — no default to fall
 * back to.
 *
 * The form a *ceiling* needs. A plugin that ships its own default cannot be
 * handed `{ maxSteps: undefined }`, because spreading that overwrites the
 * default with nothing; the caller conditionally spreads on this instead.
 */
export function readOptionalPositiveInt(name: string): number | undefined {
    const raw = readEnv(name);
    if (!raw) {
        return undefined;
    }
    // Plain decimal digits only. `Number` would also take `1e9`, `0x20` and
    // `Infinity`, none of which anyone means to write in a `.env`.
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
        throw new Error(
            `Environment variable ${name} must be a positive whole number ` +
                `(got "${raw}").`
        );
    }
    return Number(raw);
}

/**
 * As {@link readPositiveInt}, but `0` is a **value** rather than a refusal.
 *
 * The form a setting whose off-switch is spelled `0` needs. A retention window
 * is the case in hand: `OUTBOX_RETENTION_DAYS=0` is documented in four places
 * as "keep delivered events forever", and read through `readPositiveInt` that
 * documented off-switch threw at load — so a deployment that took `.env.example`
 * at its word got a server that refused to start, with a message insisting the
 * value be positive (ORT-211).
 *
 * Only zero moves. A negative, a decimal, exponent and hex notation are refused
 * exactly as before, because "off" is spelled `0` and nothing else — and the
 * reason `readPositiveInt` exists is that `Number(x) || default` accepted all
 * of them in silence.
 *
 * Choosing between the two readers is therefore a question about the setting,
 * not about its type: does `0` mean something here? For a TTL, a step ceiling
 * or a rate limit it does not, and {@link readPositiveInt} is right — a `0`
 * there is a typo that would disable the protection it configures.
 */
export function readNonNegativeInt(name: string, fallback: number): number {
    const raw = readEnv(name);
    if (!raw) {
        return fallback;
    }
    // Plain decimal digits only, as in `readOptionalPositiveInt` — `Number`
    // would also take `1e9`, `0x20` and `Infinity`.
    if (!/^\d+$/.test(raw)) {
        throw new Error(
            `Environment variable ${name} must be a whole number of zero or ` +
                `more (got "${raw}").`
        );
    }
    return Number(raw);
}

/**
 * A comma-separated list setting, trimmed and emptied of blanks.
 *
 * An explicitly empty value yields an empty list rather than the fallback,
 * because "allow no origins" is a setting somebody means.
 */
export function readList(name: string, fallback: string): string[] {
    return (process.env[name] ?? fallback)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * Express's `trust proxy` setting, in the three shapes it accepts.
 *
 * Checked in this order: a hop count (`'1'` — the recommended form, and the
 * only one a client cannot forge past), a boolean (`'true'` trusts the entire
 * `X-Forwarded-For` chain, `'false'` trusts none), or any other non-empty
 * string, passed to Express verbatim as a subnet/preset list (`'loopback'`,
 * `'10.0.0.0/8'`). Unset yields `undefined`, leaving Express's default of
 * ignoring forwarded headers entirely.
 *
 * Returns the union structurally rather than importing `TrustProxySetting`
 * from `@apograph/bootstrap-server`: this is a leaf helper package, and the
 * host importing it must not become a dependency of it. The host's own
 * `trustProxy?: TrustProxySetting` field is what checks the two agree.
 */
export function readTrustProxy(
    name = 'TRUST_PROXY'
): boolean | number | string | undefined {
    const raw = readEnv(name);
    if (!raw) {
        return undefined;
    }
    const hops = Number(raw);
    if (Number.isInteger(hops) && hops >= 0) {
        return hops;
    }
    if (raw === 'true' || raw === 'false') {
        return raw === 'true';
    }
    return raw;
}

/** The deployment modes an Apograph app recognises. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;

/** One of {@link NODE_ENVS}. */
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Reads `NODE_ENV`, rejecting a value that is neither recognised nor empty.
 *
 * `NODE_ENV !== 'production'` is the switch behind **two** protections at once
 * — whether the API reference and GraphiQL are published, and whether the
 * session cookie carries `Secure` — so any value that is not exactly
 * `production` turns both off. Unset is a legitimate, and the common, local
 * state; a *typo* is not, and it is indistinguishable from correct
 * configuration until you read a `Set-Cookie` header. Measured: `produciton`
 * serves `/reference/json` to an unauthenticated caller and drops `Secure`
 * from the session cookie, exactly as if nothing had been set (ORT-137).
 *
 * Rejecting the typo costs a deployment that spells it right nothing, and
 * turns a silent downgrade into a refusal to start.
 */
export function readNodeEnv(): NodeEnv | undefined {
    const raw = readEnv('NODE_ENV');
    if (!raw) {
        return undefined;
    }
    if (!(NODE_ENVS as readonly string[]).includes(raw)) {
        throw new Error(
            `NODE_ENV is "${raw}", which this app does not recognise — expected ` +
                `one of ${NODE_ENVS.join(', ')}, or nothing at all for local ` +
                'development. Anything else reads as "not production", which ' +
                'publishes the API reference and drops `Secure` from the session ' +
                'cookie.'
        );
    }
    return raw as NodeEnv;
}

/**
 * True only in a deployment that said `production`, with the spelling checked
 * by {@link readNodeEnv}.
 */
export function isProduction(): boolean {
    return readNodeEnv() === 'production';
}

/**
 * As {@link readList}, but `undefined` when the variable is unset, so the
 * consumer's own default list survives rather than being replaced by an empty
 * one.
 *
 * The list counterpart to {@link readOptionalPositiveInt}, and needed for the
 * same reason: a setting whose owner ships a default cannot be handed an empty
 * array meaning "the deployment said nothing".
 */
export function readOptionalList(name: string): string[] | undefined {
    return when(readEnv(name), () => readList(name, ''));
}

/**
 * A boolean setting: what the deployment said, or `fallback` when it said
 * nothing.
 *
 * Anything other than `true` reads as false, so a typo turns a switch **off**
 * rather than on. That direction is deliberate: the switches this reads are
 * kill switches for surfaces that send content to a third party or open a door
 * for an external agent, and a misspelling should not open one.
 */
export function readFlag(name: string, fallback: boolean): boolean {
    const raw = readEnv(name);
    return raw === undefined ? fallback : raw === 'true';
}

/**
 * The value when the setting was configured, `undefined` when it was not.
 *
 * The counterpart to {@link defined}: together they replace
 * `...(x ? { key: … } : {})` at a config site. `build` is a thunk so its body —
 * often several further reads — runs only when it applies, which is what lets a
 * whole provider block sit behind one credential check.
 */
export function when<T>(configured: unknown, build: () => T): T | undefined {
    return configured ? build() : undefined;
}

/**
 * The same object with every `undefined`-valued key removed.
 *
 * A plugin merges its own defaults as `{ ...DEFAULTS, ...config }`, so an
 * explicit `{ maxSteps: undefined }` does not leave `DEFAULT_RUN_LIMITS.maxSteps`
 * in place — it erases it. Dropping the key is what "the deployment did not set
 * this" has to mean, and saying it once at the end of a builder is why a config
 * file no longer needs a conditional per optional setting.
 */
export function defined<T extends object>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) {
            result[key] = item;
        }
    }
    return result as T;
}
