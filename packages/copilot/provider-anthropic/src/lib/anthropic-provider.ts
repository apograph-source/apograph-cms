import {
    abortedEvent,
    isAbortError,
    resolveModel,
    type ModelCapabilities,
    type ModelProvider,
    type ModelRequest,
    type ModelStreamEvent
} from '@orthacms/copilot-domain';
import { fallbackCapabilities, probeCapabilities } from './capabilities';
import { createLazyClient } from './client';
import type { AnthropicProviderConfig } from './config';
import { toStreamParams } from './wire/request';
import { toStopReason, toUsage } from './wire/response';

/**
 * Creates the native Claude adapter — the default for tool-heavy work, and the
 * path on which native capabilities stay available
 * ([ADR-0004](../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §3).
 *
 * This file holds only the orchestration; the parts worth reading on their own
 * live beside it — `client.ts` (lazy construction), `capabilities.ts` (the
 * Models API probe), and `wire/` (the two mapping directions).
 *
 * @example
 * ```typescript
 * CopilotPlugin({
 *     providers: {
 *         anthropic: createAnthropicProvider(config.plugins.copilot.anthropic)
 *     },
 *     config: config.plugins.copilot
 * });
 * ```
 */
export function createAnthropicProvider(
    config: AnthropicProviderConfig
): ModelProvider {
    const client = createLazyClient(config);
    const models = [...config.models];
    // Cached per model: the probe is one network call per model, and a
    // provider offering three shouldn't pay it three times per run.
    const cachedCapabilities = new Map<string, Promise<ModelCapabilities>>();

    async function* stream(
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent> {
        // Resolved before the try: a run naming a model this provider doesn't
        // offer is the caller's error, not an abort to be swallowed.
        const model = resolveModel(request.model, models);

        // Opening the stream lives inside the try alongside iterating it: an
        // already-aborted signal makes the SDK reject at construction, and
        // that is still an abort rather than a failure the caller should see.
        try {
            const messageStream = client().messages.stream(
                toStreamParams(request, config, model),
                signal ? { signal } : undefined
            );

            for await (const event of messageStream) {
                if (
                    event.type === 'content_block_delta' &&
                    event.delta.type === 'text_delta'
                ) {
                    yield { type: 'text-delta', text: event.delta.text };
                }
            }

            // Tool calls come from the assembled message rather than from
            // `input_json_delta` fragments, so a call is emitted once, whole,
            // and already parsed — the engine never sees half a call.
            const message = await messageStream.finalMessage();
            for (const block of message.content) {
                if (block.type === 'tool_use') {
                    yield {
                        type: 'tool-call',
                        id: block.id,
                        name: block.name,
                        input: block.input
                    };
                }
            }

            yield {
                type: 'done',
                stopReason: toStopReason(message.stop_reason),
                usage: toUsage(message.usage)
            };
        } catch (error) {
            if (isAbortError(error, signal)) {
                yield abortedEvent();
                return;
            }
            throw error;
        }
    }

    return {
        models: () => models,
        capabilities(model?: string): Promise<ModelCapabilities> {
            const resolved = resolveModel(model, models);
            const cached = cachedCapabilities.get(resolved);
            if (cached) {
                return cached;
            }
            // The *promise* is cached, before it resolves, so two concurrent
            // callers await one probe rather than two.
            const probe = probeCapabilities(client, resolved).catch(() => {
                // A failed probe is **not** kept: caching it would pin a
                // frontier model to the conservative fallback for the life of
                // the process over one blip — the network comes back and the
                // adapter never notices. Evicting costs at most one probe per
                // call while the endpoint is unreachable.
                cachedCapabilities.delete(resolved);
                return fallbackCapabilities(resolved);
            });
            cachedCapabilities.set(resolved, probe);
            return probe;
        },
        stream
    };
}
