import {
    abortedEvent,
    isAbortError,
    resolveModel,
    type ModelCapabilities,
    type ModelProvider,
    type ModelRequest,
    type ModelStopReason,
    type ModelStreamEvent,
    type ModelUsage
} from '@orthacms/copilot-domain';
import {
    DEFAULT_TIMEOUT_MS,
    resolveCapabilities,
    resolveEndpoint,
    resolveMaxRetries,
    type OpenAiProviderConfig
} from './config';
import { delay, isRetryableStatus, nextAttemptDelayMs } from './retry';
import { readDataEvents } from './sse';
import { toRequestBody, toRequestHeaders } from './wire/request';
import { toStopReason, toUsage } from './wire/response';
import { createToolCallAccumulator } from './wire/tool-call-accumulator';
import type { ChatCompletionChunk } from './wire/types';

/**
 * The result of one attempt at opening the stream: either the body to read, or
 * the failure and whether another attempt is worth making.
 */
type OpenAttempt =
    | { body: ReadableStream<Uint8Array>; error?: undefined }
    | {
          body?: undefined;
          error: Error;
          retryable: boolean;
          retryAfter?: string | null;
      };

/**
 * Creates the OpenAI-compatible adapter. One configurable `baseUrl` covers
 * Ollama, vLLM, llama.cpp, LM Studio, LiteLLM, OpenRouter, Azure and OpenAI
 * itself — which is what makes a local, air-gapped install a configuration
 * choice rather than a fork
 * ([ADR-0004](../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §3).
 *
 * This file holds only the request/stream orchestration. The pieces worth
 * reading on their own live beside it — `sse.ts` (event-stream parsing),
 * `wire/request.ts` and `wire/response.ts` (the two mapping directions), and
 * `wire/tool-call-accumulator.ts` (fragment assembly).
 *
 * @example
 * ```typescript
 * createOpenAiProvider({
 *     baseUrl: 'http://localhost:11434/v1',
 *     model: 'llama3.1',
 *     capabilities: { contextWindow: 8_192 }
 * });
 * ```
 */
export function createOpenAiProvider(
    config: OpenAiProviderConfig
): ModelProvider {
    const endpoint = resolveEndpoint(config.baseUrl);
    // A non-positive budget is taken as "unset", not honoured: `?? DEFAULT` let
    // a `timeoutMs: 0` through, and `AbortSignal.timeout(0)` fires immediately
    // — every request aborting before it left, which reads as the endpoint
    // being down rather than as the misconfiguration it is.
    const timeoutMs =
        config.timeoutMs !== undefined && config.timeoutMs > 0
            ? config.timeoutMs
            : DEFAULT_TIMEOUT_MS;
    const models = [...config.models];
    const maxRetries = resolveMaxRetries(config);

    async function* stream(
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent> {
        // Resolved before the request is built, so a run naming a model this
        // endpoint doesn't serve fails loudly instead of silently answering
        // on the default one.
        const model = resolveModel(request.model, models);
        const timeout = AbortSignal.timeout(timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

        try {
            const body = await open(request, model, combined);

            const toolCalls = createToolCallAccumulator();
            let stopReason: ModelStopReason = 'end';
            let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

            for await (const payload of readDataEvents(body)) {
                const chunk = parseChunk(payload);
                if (!chunk) {
                    continue;
                }

                if (chunk.usage) {
                    usage = toUsage(chunk.usage);
                }

                const choice = chunk.choices?.[0];
                if (!choice) {
                    continue;
                }
                if (choice.delta?.content) {
                    yield { type: 'text-delta', text: choice.delta.content };
                }
                toolCalls.add(choice.delta?.tool_calls ?? []);
                if (choice.finish_reason) {
                    stopReason = toStopReason(choice.finish_reason);
                }
            }

            yield* toolCalls.drain();
            yield { type: 'done', stopReason, usage };
        } catch (error) {
            if (isAbortError(error, signal)) {
                yield abortedEvent();
                return;
            }
            if (timeout.aborted) {
                throw new Error(
                    `Copilot model request to ${endpoint} timed out after ${timeoutMs}ms.`
                );
            }
            throw error;
        }
    }

    /**
     * Opens the stream, retrying a transient **pre-stream** failure.
     *
     * Every retry decision is made before a single event has been yielded —
     * the boundary that makes a second attempt safe (see `retry.ts`).
     */
    async function open(
        request: ModelRequest,
        model: string,
        combined: AbortSignal
    ): Promise<ReadableStream<Uint8Array>> {
        for (let attempt = 0; ; attempt++) {
            const outcome = await attemptOpen(request, model, combined);
            if (outcome.body) {
                return outcome.body;
            }
            if (!outcome.retryable || attempt >= maxRetries) {
                throw outcome.error;
            }
            const wait = nextAttemptDelayMs(attempt, outcome.retryAfter);
            // `undefined` is the endpoint asking for longer than this adapter
            // will wait — reporting its 429 beats sleeping through the run.
            if (wait === undefined) {
                throw outcome.error;
            }
            await delay(wait, combined);
        }
    }

    /**
     * One attempt: either a response with a body to stream, or the failure and
     * whether it is worth another go.
     *
     * An abort — the caller's or the request timeout's — is thrown rather than
     * returned: it is never transient, and re-attempting on a dead signal would
     * fail instantly `maxRetries` times before reporting it.
     */
    async function attemptOpen(
        request: ModelRequest,
        model: string,
        combined: AbortSignal
    ): Promise<OpenAttempt> {
        let response: Response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: toRequestHeaders(config),
                body: JSON.stringify(toRequestBody(request, config, model)),
                signal: combined
            });
        } catch (error) {
            if (combined.aborted || isAbortError(error)) {
                throw error;
            }
            // A refused connection, a reset, a DNS blip — the class the
            // Anthropic SDK retries and this adapter did not.
            return {
                error:
                    error instanceof Error ? error : new Error(String(error)),
                retryable: true
            };
        }

        if (response.ok && response.body) {
            return { body: response.body };
        }

        // Built eagerly: it reads the detail worth reporting *and* drains a
        // body we are about to abandon.
        return {
            error: await requestError(response),
            // An `ok` response with no body is a malformed answer, not a blip:
            // the endpoint replied, so asking again gets the same reply.
            retryable: !response.ok && isRetryableStatus(response.status),
            retryAfter: response.headers.get('retry-after')
        };
    }

    /** Builds the error for a non-2xx response, including any body detail. */
    async function requestError(response: Response): Promise<Error> {
        const detail = response.body
            ? await response.text().catch(() => '')
            : '';
        return new Error(
            `Copilot model request to ${endpoint} failed: ${response.status} ${response.statusText}` +
                (detail ? ` — ${detail.slice(0, 500)}` : '')
        );
    }

    return {
        models: () => models,
        capabilities(model?: string): Promise<ModelCapabilities> {
            return Promise.resolve(
                resolveCapabilities(config, resolveModel(model, models))
            );
        },
        stream
    };
}

/** A keep-alive or non-JSON comment line is not our problem — skip it. */
function parseChunk(payload: string): ChatCompletionChunk | undefined {
    try {
        return JSON.parse(payload) as ChatCompletionChunk;
    } catch {
        return undefined;
    }
}
