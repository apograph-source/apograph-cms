import type {
    ModelCapabilities,
    ModelProvider,
    ModelRequest,
    ModelStopReason,
    ModelUsage
} from '@orthacms/copilot-domain';

/** A tool call the script asks the fake model to "decide" to make. */
export interface FakeToolCall {
    /** Defaults to a deterministic `fake-tool-<call>-<index>`. */
    id?: string;
    /** The tool name, which must be one the run actually offered. */
    name: string;
    /** Arguments handed to the tool, already parsed. */
    input: unknown;
}

/** One scripted assistant turn: some prose, some tool calls, or both. */
export interface FakeTurn {
    /** Prose to stream, split into deltas of {@link FakeProviderConfig.chunkSize}. */
    text?: string;
    /**
     * Tool calls to emit after the text. Supplying any implies a `tool_use`
     * stop reason unless {@link stopReason} says otherwise.
     */
    toolCalls?: readonly FakeToolCall[];
    /** Overrides the inferred stop reason. */
    stopReason?: ModelStopReason;
    /** Overrides the derived token counts. */
    usage?: ModelUsage;
}

/** Options for `createFakeProvider`. */
export interface FakeProviderConfig {
    /**
     * Turns to play back, one per model call, in order. **Omit to leave the
     * provider unscripted**: every call then returns the same canned reply,
     * which is what a harness constructs before a test scripts anything.
     * Supplied, running past its end throws rather than inventing an answer.
     */
    script?: readonly FakeTurn[];
    /** Overrides the reported capabilities — e.g. to exercise degraded mode. */
    capabilities?: Partial<ModelCapabilities>;
    /** Characters per `text-delta`. Defaults to 8, so assembly is exercised. */
    chunkSize?: number;
    /**
     * Model ids to advertise. Defaults to a single `fake`. Declare several to
     * exercise a model picker, or the engine's model-switching path, without a
     * real provider.
     */
    models?: readonly string[];
}

/**
 * The fake provider, plus the inspection surface tests need. `calls` is the
 * assertion target for "a viewer's run was never offered a write tool" — the
 * negative case ADR-0005 makes mandatory.
 */
export interface FakeProvider extends ModelProvider {
    /** Every request served so far, in order. */
    readonly calls: readonly ModelRequest[];
    /** Clears {@link calls} and rewinds the script — call between tests. */
    reset(): void;
}

/** The canned reply used when no script is supplied. */
export const UNSCRIPTED_REPLY =
    'The fake copilot provider is active, so no model was called. ' +
    'Script a turn with `createFakeProvider({ script })` to control what it says.';

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
    model: 'fake',
    toolCalling: true,
    streaming: true,
    vision: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000
};

export const DEFAULT_CHUNK_SIZE = 8;

export const DEFAULT_MODELS = ['fake'] as const;
