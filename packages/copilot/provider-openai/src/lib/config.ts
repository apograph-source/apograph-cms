import type { ModelCapabilities } from '@orthacms/copilot-domain';

/** Options for `createOpenAiProvider`. */
export interface OpenAiProviderConfig {
    /**
     * The API root, up to and including the version segment — e.g.
     * `http://localhost:11434/v1` (Ollama) or `https://api.openai.com/v1`.
     * `/chat/completions` is appended.
     */
    baseUrl: string;
    /**
     * Model ids this endpoint serves, in preference order; the first is the
     * default. Several models behind one endpoint is the common case — a small
     * fast one and a large one on the same Ollama — and lets a user switch
     * mid-conversation without a redeploy.
     */
    models: readonly string[];
    /** Bearer token. Omit for a local runtime that wants no auth. */
    apiKey?: string;
    /** Extra headers — an Azure `api-key`, an OpenRouter attribution header. */
    headers?: Readonly<Record<string, string>>;
    /**
     * What this endpoint's models can do. The wire format exposes no
     * capability discovery, so the operator declares it: a 3B model that
     * cannot call tools must say so, or the engine will assume a baseline it
     * cannot meet
     * ([ADR-0004](../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §4).
     *
     * Applies to **every** model on this endpoint. When two models differ
     * materially — one calls tools, one doesn't — register them as two
     * providers instead of flattening both to the weaker profile.
     */
    capabilities?: Partial<Omit<ModelCapabilities, 'model'>>;
    /**
     * Request timeout in milliseconds. Defaults to 120 000.
     *
     * Budgets the **whole** attempt ladder, retries and backoff included — a
     * transient failure must not be able to multiply a run's wall clock by
     * `maxRetries`.
     */
    timeoutMs?: number;
    /**
     * Retries on a pre-stream 408/429/5xx or a failed connection. Defaults to
     * `2`, matching the Anthropic SDK's own ladder; `0` attempts once.
     *
     * Only ever applied **before the first event** — see `retry.ts`.
     */
    maxRetries?: number;
    /**
     * Which field carries the output ceiling on the wire.
     *
     * `max_tokens` is the long-standing name and the one every local runtime
     * understands, so it stays the default. OpenAI's reasoning models **reject**
     * it and require `max_completion_tokens` — a deployment pointing this at
     * them has to say so, because the two names cannot both be sent (an
     * unrecognised parameter is itself a 400 there).
     */
    maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}

/** The wire field the output ceiling rides on unless the operator says otherwise. */
export const DEFAULT_MAX_TOKENS_FIELD = 'max_tokens';

/** Optimistic defaults — the frontier-model case, overridden per deployment. */
export const DEFAULT_CAPABILITIES = {
    toolCalling: true,
    streaming: true,
    vision: false,
    contextWindow: 32_768,
    maxOutputTokens: 4_096
} as const;

export const DEFAULT_TIMEOUT_MS = 120_000;

/** Matches the Anthropic SDK's ladder, so the two adapters agree. */
export const DEFAULT_MAX_RETRIES = 2;

/**
 * Resolves the retry count. Unlike `timeoutMs`, `0` is meaningful here — "one
 * attempt, report what happened" is a legitimate choice for an operator who
 * would rather see a 429 than wait through it — so only `undefined` takes the
 * default, and a negative is floored to `0` rather than inverting the loop.
 */
export function resolveMaxRetries(config: OpenAiProviderConfig): number {
    return config.maxRetries === undefined
        ? DEFAULT_MAX_RETRIES
        : Math.max(0, Math.floor(config.maxRetries));
}

/** Appends the chat-completions path, tolerating a trailing slash on the root. */
export function resolveEndpoint(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/** Merges the operator's declared capabilities over the defaults, for one model. */
export function resolveCapabilities(
    config: OpenAiProviderConfig,
    model: string
): ModelCapabilities {
    return {
        ...DEFAULT_CAPABILITIES,
        ...config.capabilities,
        model
    };
}
