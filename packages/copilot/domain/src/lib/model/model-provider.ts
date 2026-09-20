import type { ModelCapabilities } from './model-capabilities';
import type { ModelMessage, ModelTool } from './model-message';

/** One model call: the prompt, the tools on offer, and the output ceiling. */
export interface ModelRequest {
    /**
     * Provider-specific model id, e.g. `claude-opus-5` or `llama3.1`. Omit to
     * use the provider's configured default — the usual case, since the model
     * is a deployment choice rather than a per-run one.
     */
    model?: string;
    /** The system prompt. Assembled by the engine, never user-authored. */
    system?: string;
    /** The conversation so far, oldest first. */
    messages: readonly ModelMessage[];
    /**
     * Tools this run may invoke — already filtered to the caller's capability
     * profile, because a tool the model was never told about cannot be
     * requested ([ADR-0005](../../../../../docs/adr/0005-copilot-authority-model.md) §3).
     */
    tools?: readonly ModelTool[];
    /** Hard ceiling on the response, in tokens. */
    maxOutputTokens: number;
}

/** Tokens consumed by one model call — the input to cost and quota accounting. */
export interface ModelUsage {
    /** Tokens billed as input, excluding anything served from a cache. */
    inputTokens: number;
    /** Tokens the model generated. */
    outputTokens: number;
    /** Input tokens served from a provider-side prompt cache, when reported. */
    cachedInputTokens?: number;
    /**
     * Input tokens **written** to a provider-side prompt cache, when reported.
     *
     * Disjoint from both counts above — a provider reports the prompt as
     * uncached + read + written — and billed at a premium (~1.25x) rather than
     * free. Carried separately so a run's ceiling can add it: without it,
     * turning caching on would make a run look cheaper than it is, and a token
     * budget that silently stops counting part of the spend is worse than one
     * tuned too low.
     */
    cacheWriteInputTokens?: number;
}

/** Why the model stopped generating. */
export type ModelStopReason =
    /** A complete answer. */
    | 'end'
    /** The model wants one or more tools run before continuing. */
    | 'tool_use'
    /** Hit {@link ModelRequest.maxOutputTokens} — the answer is truncated. */
    | 'max_tokens'
    /** The provider's safety classifiers declined the request. */
    | 'refusal'
    /** The caller aborted via the signal passed to {@link ModelProvider.stream}. */
    | 'aborted';

/** A chunk of the answer, forwarded to the client as it arrives. */
export interface TextDeltaEvent {
    type: 'text-delta';
    /** The new text. Concatenating every delta yields the full answer. */
    text: string;
}

/**
 * A complete tool call. Providers buffer partial argument JSON internally and
 * emit this only once the arguments parse — the engine never sees half a call.
 */
export interface ToolCallEvent {
    type: 'tool-call';
    /** Provider-assigned id, echoed back on the tool result. */
    id: string;
    /** The requested tool's name. */
    name: string;
    /** Parsed arguments. Validated against the tool's schema by the engine. */
    input: unknown;
}

/** The terminal event. Exactly one of these ends a well-behaved stream. */
export interface DoneEvent {
    type: 'done';
    /** Why generation stopped. */
    stopReason: ModelStopReason;
    /** Tokens consumed by this call. */
    usage: ModelUsage;
}

/**
 * The normalised event stream every adapter produces. Two wire formats, two
 * tool-call encodings and two usage shapes collapse to this one vocabulary, so
 * the engine never branches per vendor.
 */
export type ModelStreamEvent = TextDeltaEvent | ToolCallEvent | DoneEvent;

/**
 * The model boundary. Implementations live in separate packages
 * (`@orthacms/copilot-provider-anthropic`, `@orthacms/copilot-provider-openai`,
 * and the private test fixture `@orthacms/copilot-provider-fake`) and are
 * registered at the composition root. The copilot core depends only on this
 * interface — **never** on a vendor SDK
 * ([ADR-0004](../../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §1).
 */
export interface ModelProvider {
    /**
     * The model ids this provider offers, in declaration order; the first is
     * the default a request gets when it names none.
     *
     * A provider serves **several** models on purpose — one endpoint and one
     * credential, a cheap model for routine turns and a frontier one for hard
     * work — so an operator (or a user, mid-conversation) can switch without a
     * redeploy. Synchronous: this is declared configuration, so a model picker
     * can render it without a round trip.
     */
    models(): readonly string[];
    /**
     * What one of this provider's models can do. Defaults to the provider's
     * first model. Async because an adapter may probe a live endpoint (the
     * Models API, a local runtime's `/models`) rather than answer from a table.
     */
    capabilities(model?: string): Promise<ModelCapabilities>;
    /**
     * Runs one model call, yielding normalised events.
     *
     * Three clauses bind every adapter, and an adapter that breaks one
     * produces figures the engine has no way to detect as wrong:
     *
     * 1. **Exactly one `done` ends the stream.** A stream that ends without
     *    one is read as `stopReason: 'end'` with zero usage, which silently
     *    under-counts the run; a second one overwrites the first.
     * 2. **An abort ends the stream, it does not throw out of it.** Aborting
     *    `signal` must stop the iteration promptly with a `done` carrying
     *    `stopReason: 'aborted'`.
     * 3. **An aborted call reports zero usage** — `inputTokens: 0`,
     *    `outputTokens: 0`, including when text had already streamed. A
     *    cancelled call never reaches a usage record the provider can trust,
     *    and a partial estimate is a guess entering cost accounting as a fact.
     *    Emit {@link abortedEvent} rather than restating it.
     */
    stream(
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent>;
}

/** What the core knows about a run when choosing a provider. */
export interface ModelRunContext {
    /** The workspace the run is scoped to. */
    workspaceId: string;
    /** The user the run acts as — the copilot has no identity of its own. */
    userId: string;
}

/** One selectable backend: a registered provider plus one of its models. */
export interface ModelChoice {
    /** The provider's registered name, e.g. `claude` or `ollama`. */
    provider: string;
    /** A model id that provider offers. */
    model: string;
}

/** The named providers available to route between. */
export interface ModelRegistry {
    /** Resolves a provider by name; throws if the name isn't registered. */
    get(name: string): ModelProvider;
    /** Whether a provider is registered under `name`. */
    has(name: string): boolean;
    /** Every registered provider name. */
    names(): string[];
    /**
     * Every provider × model pair on offer, in registration order — what a
     * model picker renders, and the full set a run may legally choose from.
     */
    catalogue(): ModelChoice[];
}

/** DI token the composition root binds to the {@link ModelRegistry}. */
export const MODEL_REGISTRY = Symbol('MODEL_REGISTRY');

/**
 * The optional custom handler that picks WHICH registered provider serves a
 * given run — full custom code, returning a provider NAME present in the
 * registry. If the host supplies none, the core uses the **first registered
 * provider** for every run that names none of its own.
 *
 * A run that does name a provider wins over this handler either way, so in
 * practice it routes the callers that cannot pick — MCP and API clients — while
 * the admin sends the model the person is looking at in the picker.
 */
export type ModelResolver = (
    ctx: ModelRunContext,
    providers: ModelRegistry
) => string;

/** DI token the composition root binds to the {@link ModelResolver}. */
export const MODEL_RESOLVER = Symbol('MODEL_RESOLVER');
