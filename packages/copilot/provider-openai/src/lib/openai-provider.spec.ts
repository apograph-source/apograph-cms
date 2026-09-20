import type { ModelRequest, ModelStreamEvent } from '@orthacms/copilot-domain';
import { createOpenAiProvider } from './openai-provider';

/** Builds an SSE response body from chunk objects, plus the `[DONE]` sentinel. */
function sseResponse(chunks: unknown[], status = 200): Response {
    const text =
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
        'data: [DONE]\n\n';
    return new Response(text, {
        status,
        headers: { 'content-type': 'text/event-stream' }
    });
}

const request: ModelRequest = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxOutputTokens: 256
};

const provider = () =>
    createOpenAiProvider({
        baseUrl: 'http://localhost:11434/v1/',
        models: ['llama3.1', 'qwen2.5']
    });

async function drain(
    events: AsyncIterable<ModelStreamEvent>
): Promise<ModelStreamEvent[]> {
    const collected: ModelStreamEvent[] = [];
    for await (const event of events) {
        collected.push(event);
    }
    return collected;
}

function lastBody(): Record<string, unknown> {
    const call = jest.mocked(globalThis.fetch).mock.calls.at(-1);
    return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

/**
 * Streaming normalisation is the genuine work in this adapter (ADR-0004
 * "Consequences"): two wire formats, two tool-call encodings and two usage
 * shapes have to collapse to one internal event stream.
 */
describe('createOpenAiProvider', () => {
    beforeEach(() => {
        globalThis.fetch = jest.fn();
    });

    it('posts to <baseUrl>/chat/completions without doubling the slash', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        await drain(provider().stream(request));

        expect(jest.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
            'http://localhost:11434/v1/chat/completions'
        );
    });

    it('forwards text deltas in order', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            sseResponse([
                { choices: [{ delta: { content: 'Hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            ])
        );

        const events = await drain(provider().stream(request));

        expect(events).toEqual([
            { type: 'text-delta', text: 'Hel' },
            { type: 'text-delta', text: 'lo' },
            {
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        ]);
    });

    it('assembles a tool call from argument fragments and emits it once', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            sseResponse([
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        function: {
                                            name: 'admin_content_search',
                                            arguments: '{"q":'
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                },
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        function: { arguments: '"launch"}' }
                                    }
                                ]
                            }
                        }
                    ]
                },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            ])
        );

        const events = await drain(provider().stream(request));

        expect(events.filter((event) => event.type === 'tool-call')).toEqual([
            {
                type: 'tool-call',
                id: 'call_1',
                name: 'admin_content_search',
                input: { q: 'launch' }
            }
        ]);
        expect(events.at(-1)).toMatchObject({ stopReason: 'tool_use' });
    });

    it('emits parallel tool calls in index order', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            sseResponse([
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 1,
                                        id: 'b',
                                        function: {
                                            name: 'second',
                                            arguments: '{}'
                                        }
                                    },
                                    {
                                        index: 0,
                                        id: 'a',
                                        function: {
                                            name: 'first',
                                            arguments: '{}'
                                        }
                                    }
                                ]
                            },
                            finish_reason: 'tool_calls'
                        }
                    ]
                }
            ])
        );

        const events = await drain(provider().stream(request));

        expect(
            events
                .filter((event) => event.type === 'tool-call')
                .map((event) => event.name)
        ).toEqual(['first', 'second']);
    });

    it('falls back to an empty input when the model emits malformed JSON', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            sseResponse([
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        function: {
                                            name: 'broken',
                                            arguments: '{not json'
                                        }
                                    }
                                ]
                            },
                            finish_reason: 'tool_calls'
                        }
                    ]
                }
            ])
        );

        const events = await drain(provider().stream(request));

        expect(events).toContainEqual({
            type: 'tool-call',
            id: 'call_1',
            name: 'broken',
            input: {}
        });
    });

    it('reads usage from the trailing usage-only chunk', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            sseResponse([
                {
                    choices: [
                        { delta: { content: 'x' }, finish_reason: 'stop' }
                    ]
                },
                {
                    choices: [],
                    usage: {
                        prompt_tokens: 120,
                        completion_tokens: 7,
                        prompt_tokens_details: { cached_tokens: 64 }
                    }
                }
            ])
        );

        const events = await drain(provider().stream(request));

        expect(events.at(-1)).toEqual({
            type: 'done',
            stopReason: 'end',
            usage: { inputTokens: 120, outputTokens: 7, cachedInputTokens: 64 }
        });
    });

    it('maps `length` to max_tokens and `content_filter` to refusal', async () => {
        for (const [finish, expected] of [
            ['length', 'max_tokens'],
            ['content_filter', 'refusal']
        ] as const) {
            jest.mocked(globalThis.fetch).mockResolvedValue(
                sseResponse([
                    { choices: [{ delta: {}, finish_reason: finish }] }
                ])
            );

            const events = await drain(provider().stream(request));
            expect(events.at(-1)).toMatchObject({ stopReason: expected });
        }
    });

    it('flattens tool results onto their own `tool` messages', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        await drain(
            provider().stream({
                system: 'You are the copilot.',
                messages: [
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'call_1',
                                name: 'search',
                                input: { q: 'x' }
                            }
                        ]
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                toolUseId: 'call_1',
                                content: '3 results'
                            }
                        ]
                    }
                ],
                maxOutputTokens: 256
            })
        );

        expect(lastBody().messages).toEqual([
            { role: 'system', content: 'You are the copilot.' },
            {
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'search', arguments: '{"q":"x"}' }
                    }
                ]
            },
            { role: 'tool', tool_call_id: 'call_1', content: '3 results' }
        ]);
    });

    it('sends tools in the function-calling shape, and omits the key when there are none', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));
        await drain(provider().stream(request));
        expect(lastBody()).not.toHaveProperty('tools');

        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));
        await drain(
            provider().stream({
                ...request,
                tools: [
                    {
                        name: 'admin_content_search',
                        description: 'Search entries',
                        inputSchema: { type: 'object' }
                    }
                ]
            })
        );

        expect(lastBody().tools).toEqual([
            {
                type: 'function',
                function: {
                    name: 'admin_content_search',
                    description: 'Search entries',
                    parameters: { type: 'object' }
                }
            }
        ]);
    });

    it('sends the output ceiling on `max_tokens`, or the field the operator named', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));
        await drain(provider().stream(request));

        expect(lastBody()['max_tokens']).toBe(256);
        expect(lastBody()).not.toHaveProperty('max_completion_tokens');

        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));
        await drain(
            createOpenAiProvider({
                baseUrl: 'http://localhost:11434/v1',
                models: ['o3-mini'],
                maxTokensField: 'max_completion_tokens'
            }).stream(request)
        );

        // The two names cannot both be sent: an unrecognised parameter is
        // itself a 400 on the endpoints that require the newer one.
        expect(lastBody()['max_completion_tokens']).toBe(256);
        expect(lastBody()).not.toHaveProperty('max_tokens');
    });

    it('combines the caller signal with the request timeout', async () => {
        // Both must be able to end the request: the caller's Stop button and
        // the endpoint that never answers.
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));
        const controller = new AbortController();

        await drain(provider().stream(request, controller.signal));

        const signal = jest
            .mocked(globalThis.fetch)
            .mock.calls.at(-1)?.[1]?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);
        controller.abort();
        expect(signal?.aborted).toBe(true);
    });

    it('treats a non-positive timeout as unset rather than as "abort now"', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        const events = await drain(
            createOpenAiProvider({
                baseUrl: 'http://localhost:11434/v1',
                models: ['llama3.1'],
                timeoutMs: 0
            }).stream(request)
        );

        expect(events.at(-1)).toMatchObject({ type: 'done' });
    });

    it('names the endpoint and the budget when the request times out', async () => {
        jest.mocked(globalThis.fetch).mockImplementation((_url, init) => {
            const error = Object.assign(new Error('timed out'), {
                name: 'TimeoutError'
            });
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(error));
            });
        });

        await expect(
            drain(
                createOpenAiProvider({
                    baseUrl: 'http://localhost:11434/v1',
                    models: ['llama3.1'],
                    timeoutMs: 5
                }).stream(request)
            )
        ).rejects.toThrow(
            'Copilot model request to http://localhost:11434/v1/chat/completions timed out after 5ms.'
        );
    });

    it('raises a request error naming the endpoint, the status and the body', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            new Response('model not found', {
                status: 404,
                statusText: 'Not Found'
            })
        );

        // The endpoint and the upstream detail are what an operator needs to
        // diagnose a misconfigured base URL. They are also, today, forwarded
        // verbatim to the browser by the run engine's `userFacingMessage` —
        // pinned here so a change to either half is a visible one.
        await expect(drain(provider().stream(request))).rejects.toThrow(
            'Copilot model request to http://localhost:11434/v1/chat/completions failed: 404 Not Found — model not found'
        );
    });

    it('lets config.headers override the bearer token it would otherwise send', async () => {
        // Deliberate, and the shape an Azure `api-key` deployment needs: the
        // spread order makes the operator's headers the last word.
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        await drain(
            createOpenAiProvider({
                baseUrl: 'http://localhost:11434/v1',
                models: ['llama3.1'],
                apiKey: 'sk-ignored',
                headers: { authorization: 'Bearer other', 'x-org': 'acme' }
            }).stream(request)
        );

        expect(
            jest.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.headers
        ).toEqual({
            'content-type': 'application/json',
            authorization: 'Bearer other',
            'x-org': 'acme'
        });
    });

    it('reports an empty answer when a 200 carries no event stream at all', async () => {
        // A server that ignored `stream: true` and answered with one JSON body
        // lands here: `ok` is true, there are no `data:` lines, and the run ends
        // with nothing to show rather than with an error naming the cause.
        jest.mocked(globalThis.fetch).mockResolvedValue(
            new Response('{"choices":[{"message":{"content":"hi"}}]}', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        expect(await drain(provider().stream(request))).toEqual([
            {
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        ]);
    });

    it('ends with `aborted` rather than throwing when the caller cancels', async () => {
        const controller = new AbortController();
        jest.mocked(globalThis.fetch).mockImplementation(() => {
            controller.abort();
            return Promise.reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
            );
        });

        const events = await drain(
            provider().stream(request, controller.signal)
        );

        expect(events).toEqual([
            {
                type: 'done',
                stopReason: 'aborted',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        ]);
    });

    it('reports operator-declared capabilities, so degraded mode is honest', async () => {
        const degraded = createOpenAiProvider({
            baseUrl: 'http://localhost:11434/v1',
            models: ['tinyllama'],
            capabilities: { toolCalling: false, contextWindow: 2_048 }
        });

        await expect(degraded.capabilities()).resolves.toEqual({
            model: 'tinyllama',
            toolCalling: false,
            streaming: true,
            vision: false,
            contextWindow: 2_048,
            maxOutputTokens: 4_096
        });
    });

    it('advertises every declared model and defaults to the first', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        expect(provider().models()).toEqual(['llama3.1', 'qwen2.5']);
        await drain(provider().stream(request));
        expect(lastBody()['model']).toBe('llama3.1');
    });

    it('sends a per-request model override', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        await drain(provider().stream({ ...request, model: 'qwen2.5' }));

        expect(lastBody()['model']).toBe('qwen2.5');
    });

    it('rejects a model this endpoint does not serve, before sending anything', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(sseResponse([]));

        await expect(
            drain(provider().stream({ ...request, model: 'gpt-4o' }))
        ).rejects.toThrow(/not offered by this copilot provider/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('reports capabilities per model, keeping the declared profile', async () => {
        await expect(provider().capabilities('qwen2.5')).resolves.toMatchObject(
            { model: 'qwen2.5', toolCalling: true }
        );
    });
});

/** A non-2xx response, optionally carrying the header that paces the retry. */
function errorResponse(status: number, retryAfter?: string): Response {
    return new Response('upstream said no', {
        status,
        ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {})
    });
}

/** A body that yields one delta and then errors, the way a dropped socket does. */
function brokenStream(): Response {
    const encoder = new TextEncoder();
    let sent = false;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent) {
                    controller.error(new Error('socket reset'));
                    return;
                }
                sent = true;
                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({
                            choices: [{ delta: { content: 'Hel' } }]
                        })}\n\n`
                    )
                );
            }
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
}

/**
 * The pre-stream retry ladder (ORT-147).
 *
 * `provider-anthropic` inherits the SDK's two attempts on 429/5xx/connection
 * errors; this adapter had none, so the same gateway restart ended a run here
 * and was invisible there. The pair of cases that matter are the boundary: a
 * failure *before* the first event is retried, one *after* it never is.
 */
describe('createOpenAiProvider retries', () => {
    beforeEach(() => {
        globalThis.fetch = jest.fn();
    });

    it('retries a 429 and streams the answer that follows', async () => {
        jest.mocked(globalThis.fetch)
            .mockResolvedValueOnce(errorResponse(429, '0'))
            .mockResolvedValueOnce(
                sseResponse([
                    { choices: [{ delta: { content: 'Hello' } }] },
                    { choices: [{ delta: {}, finish_reason: 'stop' }] }
                ])
            );

        const events = await drain(provider().stream(request));

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        // Transparent: the caller sees the answer, not the blip.
        expect(events).toContainEqual({ type: 'text-delta', text: 'Hello' });
    });

    it('retries a refused connection', async () => {
        jest.mocked(globalThis.fetch)
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
            .mockResolvedValueOnce(sseResponse([]));

        await drain(provider().stream(request));

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry once the stream has started', async () => {
        // The engine has already forwarded the delta to the browser, so a
        // second attempt would duplicate or silently replace the answer.
        jest.mocked(globalThis.fetch).mockResolvedValueOnce(brokenStream());

        await expect(drain(provider().stream(request))).rejects.toThrow(
            'socket reset'
        );
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry a status the endpoint has settled on', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(errorResponse(400));

        await expect(drain(provider().stream(request))).rejects.toThrow(/400/);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxRetries and reports the last failure', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            errorResponse(503, '0')
        );

        await expect(drain(provider().stream(request))).rejects.toThrow(/503/);
        // Two retries on top of the first attempt — the Anthropic SDK's ladder.
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('attempts once when the operator sets maxRetries to 0', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            errorResponse(503, '0')
        );
        const once = createOpenAiProvider({
            baseUrl: 'http://localhost:11434/v1',
            models: ['llama3.1'],
            maxRetries: 0
        });

        await expect(drain(once.stream(request))).rejects.toThrow(/503/);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('reports the 429 rather than sleeping through a long Retry-After', async () => {
        jest.mocked(globalThis.fetch).mockResolvedValue(
            errorResponse(429, '3600')
        );

        await expect(drain(provider().stream(request))).rejects.toThrow(/429/);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry after the caller aborts', async () => {
        const controller = new AbortController();
        jest.mocked(globalThis.fetch).mockImplementation(() => {
            controller.abort();
            return Promise.reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
            );
        });

        const events = await drain(
            provider().stream(request, controller.signal)
        );

        expect(events).toEqual([
            {
                type: 'done',
                stopReason: 'aborted',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        ]);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});
