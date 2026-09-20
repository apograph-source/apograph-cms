import {
    abortedEvent,
    resolveModel,
    type ModelCapabilities,
    type ModelRequest,
    type ModelStreamEvent
} from '@orthacms/copilot-domain';
import {
    DEFAULT_CAPABILITIES,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_MODELS,
    type FakeProvider,
    type FakeProviderConfig,
    type FakeTurn
} from './config';
import { createScriptReader } from './script';
import { chunkText } from './text';
import { estimateUsage } from './usage';

/**
 * Creates the scripted, deterministic provider. A **test fixture only**
 * ([ADR-0004](../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §3):
 * it is how `server-e2e` drives the whole tool loop with no API key and no
 * network. This package is private and publishes nowhere, and no composition
 * root registers it — a host that configured no backend has no copilot, rather
 * than one answering every question from this script.
 *
 * No network, no clock, no randomness — the run engine is a non-deterministic
 * multi-step loop, and a flaky fake would make every assertion downstream of
 * it flaky too.
 *
 * @example
 * ```typescript
 * const provider = createFakeProvider({
 *     script: [
 *         { toolCalls: [{ name: 'admin_content_search', input: { q: 'launch' } }] },
 *         { text: 'I found 3 matching articles.' }
 *     ]
 * });
 * ```
 */
export function createFakeProvider(
    config: FakeProviderConfig = {}
): FakeProvider {
    const chunkSize = Math.max(1, config.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const models = [...(config.models ?? DEFAULT_MODELS)];
    const script = createScriptReader(config.script);
    const calls: ModelRequest[] = [];

    async function* stream(
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent> {
        // Resolved even though the fake ignores it: a test that asks for an
        // unlisted model should fail the same way production would.
        resolveModel(request.model, models);
        // Snapshotted rather than aliased: the run engine appends to the very
        // array it hands over as `messages`, so a recorded call would otherwise
        // grow every later step's assistant turn and tool results — and
        // `calls[0].messages` is precisely what a test asserting "what the
        // first model call was shown" reads.
        const callIndex =
            calls.push({
                ...request,
                messages: [...request.messages],
                ...(request.tools ? { tools: [...request.tools] } : {})
            }) - 1;
        // Read the turn before checking the signal so an aborted call still
        // advances the script — the run happened, it just didn't finish.
        const turn = script.next();

        // The whole turn is planned up front and then played through one abort
        // check, so cancellation is observed at **every** boundary a real
        // adapter observes it at: before the first delta, between deltas,
        // before a tool call, and before `done`. A transport that has been torn
        // down cannot emit anything more, and a fake that kept going would let
        // a test assert events production would never have produced.
        for (const event of playbackEvents(
            turn,
            request,
            chunkSize,
            callIndex
        )) {
            if (signal?.aborted) {
                // Zero usage, per the port's third clause: a cancelled call
                // never reaches a usage record anyone can trust, and the
                // partial estimate this used to report was a guess entering
                // cost accounting as a fact — and a guess neither production
                // adapter makes, so every abort assertion in `server-e2e` was
                // being written against fake-only numbers.
                yield abortedEvent();
                return;
            }
            yield event;
        }
    }

    return {
        calls,
        reset(): void {
            calls.length = 0;
            script.reset();
        },
        models: () => models,
        capabilities(model?: string): Promise<ModelCapabilities> {
            return Promise.resolve({
                ...DEFAULT_CAPABILITIES,
                ...config.capabilities,
                model: resolveModel(model, models)
            });
        },
        stream
    };
}

/** One scripted turn as the event sequence a completed call would emit. */
function playbackEvents(
    turn: FakeTurn,
    request: ModelRequest,
    chunkSize: number,
    callIndex: number
): ModelStreamEvent[] {
    const text = turn.text ?? '';
    const toolCalls = turn.toolCalls ?? [];

    return [
        ...chunkText(text, chunkSize).map(
            (piece): ModelStreamEvent => ({ type: 'text-delta', text: piece })
        ),
        ...toolCalls.map(
            (call, index): ModelStreamEvent => ({
                type: 'tool-call',
                id: call.id ?? `fake-tool-${callIndex}-${index}`,
                name: call.name,
                input: call.input
            })
        ),
        {
            type: 'done',
            stopReason:
                turn.stopReason ?? (toolCalls.length > 0 ? 'tool_use' : 'end'),
            usage: turn.usage ?? estimateUsage(request, text)
        }
    ];
}
