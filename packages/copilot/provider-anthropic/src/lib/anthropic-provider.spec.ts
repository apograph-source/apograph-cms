import type { ModelRequest, ModelStreamEvent } from '@orthacms/copilot-domain';
import { createAnthropicProvider } from './anthropic-provider';

const mockStream = jest.fn();
const mockRetrieve = jest.fn();
const mockConstructor = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((options: unknown) => {
        mockConstructor(options);
        return {
            messages: { stream: mockStream },
            models: { retrieve: mockRetrieve }
        };
    })
}));

/** A stand-in for the SDK's `MessageStream`: async-iterable + `finalMessage`. */
function sdkStream(
    events: unknown[],
    final: unknown
): AsyncIterable<unknown> & { finalMessage: () => Promise<unknown> } {
    return {
        async *[Symbol.asyncIterator]() {
            yield* events;
        },
        finalMessage: () => Promise.resolve(final)
    };
}

const textDelta = (text: string) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text }
});

const finalMessage = (overrides: Record<string, unknown> = {}) => ({
    content: [],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 4 },
    ...overrides
});

const config = {
    apiKey: 'sk-test',
    models: ['claude-opus-5', 'claude-haiku-4-5']
};

const request: ModelRequest = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 1024
};

async function drain(
    events: AsyncIterable<ModelStreamEvent>
): Promise<ModelStreamEvent[]> {
    const collected: ModelStreamEvent[] = [];
    for await (const event of events) {
        collected.push(event);
    }
    return collected;
}

function lastParams(): Record<string, unknown> {
    return mockStream.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('createAnthropicProvider', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('the lazy client', () => {
        it('constructs no SDK client until the provider is actually used', () => {
            createAnthropicProvider({ apiKey: '', models: ['claude-opus-5'] });

            // A host registers every provider it might route to; an operator
            // running local inference has no key, and an unused adapter must
            // not break their boot.
            expect(mockConstructor).not.toHaveBeenCalled();
        });

        it('fails with a message naming the fix when selected without a key', async () => {
            const provider = createAnthropicProvider({
                apiKey: '',
                models: ['claude-opus-5']
            });

            await expect(drain(provider.stream(request))).rejects.toThrow(
                /no API key is configured/
            );
        });

        it('constructs the client once, and forwards an overridden base URL', async () => {
            mockStream.mockReturnValue(sdkStream([], finalMessage()));
            const provider = createAnthropicProvider({
                ...config,
                baseUrl: 'https://gateway.internal/v1'
            });

            await drain(provider.stream(request));
            await drain(provider.stream(request));

            expect(mockConstructor).toHaveBeenCalledTimes(1);
            expect(mockConstructor).toHaveBeenCalledWith(
                expect.objectContaining({
                    apiKey: 'sk-test',
                    baseURL: 'https://gateway.internal/v1'
                })
            );
        });

        it('forwards maxRetries and timeoutMs only when the operator set them', async () => {
            // Passing `undefined` would override the SDK's own defaults with
            // nothing, which is not the same as leaving them alone.
            mockStream.mockReturnValue(sdkStream([], finalMessage()));
            await drain(createAnthropicProvider(config).stream(request));

            expect(mockConstructor.mock.calls[0][0]).not.toHaveProperty(
                'maxRetries'
            );
            expect(mockConstructor.mock.calls[0][0]).not.toHaveProperty(
                'timeout'
            );

            await drain(
                createAnthropicProvider({
                    ...config,
                    maxRetries: 0,
                    timeoutMs: 5_000
                }).stream(request)
            );

            expect(mockConstructor).toHaveBeenLastCalledWith(
                expect.objectContaining({ maxRetries: 0, timeout: 5_000 })
            );
        });
    });

    describe('streaming', () => {
        it('forwards text deltas and ends with usage', async () => {
            mockStream.mockReturnValue(
                sdkStream(
                    [textDelta('Hel'), textDelta('lo')],
                    finalMessage({
                        usage: {
                            input_tokens: 120,
                            output_tokens: 7,
                            cache_read_input_tokens: 64
                        }
                    })
                )
            );

            const events = await drain(
                createAnthropicProvider(config).stream(request)
            );

            expect(events).toEqual([
                { type: 'text-delta', text: 'Hel' },
                { type: 'text-delta', text: 'lo' },
                {
                    type: 'done',
                    stopReason: 'end',
                    usage: {
                        inputTokens: 120,
                        outputTokens: 7,
                        cachedInputTokens: 64
                    }
                }
            ]);
        });

        it('omits cachedInputTokens when the provider reports none', async () => {
            mockStream.mockReturnValue(
                sdkStream(
                    [],
                    finalMessage({
                        usage: {
                            input_tokens: 5,
                            output_tokens: 1,
                            cache_read_input_tokens: null
                        }
                    })
                )
            );

            const events = await drain(
                createAnthropicProvider(config).stream(request)
            );

            expect(events.at(-1)).toEqual({
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: 5, outputTokens: 1 }
            });
        });

        it('reports cache writes, which the ceiling has to charge for', async () => {
            // The three input counts are disjoint — the whole prompt here is
            // 120 + 64 + 900 — and a write is billed at a premium over plain
            // input. Dropping it would make caching look free and quietly stop
            // `maxTotalTokens` from counting part of the run's spend.
            mockStream.mockReturnValue(
                sdkStream(
                    [],
                    finalMessage({
                        usage: {
                            input_tokens: 120,
                            output_tokens: 7,
                            cache_read_input_tokens: 64,
                            cache_creation_input_tokens: 900
                        }
                    })
                )
            );

            const events = await drain(
                createAnthropicProvider(config).stream(request)
            );

            expect(events.at(-1)).toEqual({
                type: 'done',
                stopReason: 'end',
                usage: {
                    inputTokens: 120,
                    outputTokens: 7,
                    cachedInputTokens: 64,
                    cacheWriteInputTokens: 900
                }
            });
        });

        it('emits tool calls from the assembled message, parsed and whole', async () => {
            mockStream.mockReturnValue(
                sdkStream(
                    [],
                    finalMessage({
                        stop_reason: 'tool_use',
                        content: [
                            { type: 'text', text: 'Looking that up.' },
                            {
                                type: 'tool_use',
                                id: 'toolu_1',
                                name: 'admin_content_search',
                                input: { q: 'launch' }
                            }
                        ]
                    })
                )
            );

            const events = await drain(
                createAnthropicProvider(config).stream(request)
            );

            expect(events).toEqual([
                {
                    type: 'tool-call',
                    id: 'toolu_1',
                    name: 'admin_content_search',
                    input: { q: 'launch' }
                },
                {
                    type: 'done',
                    stopReason: 'tool_use',
                    usage: { inputTokens: 10, outputTokens: 4 }
                }
            ]);
        });

        it.each([
            ['end_turn', 'end'],
            ['stop_sequence', 'end'],
            ['pause_turn', 'end'],
            ['tool_use', 'tool_use'],
            ['refusal', 'refusal'],
            ['max_tokens', 'max_tokens'],
            ['model_context_window_exceeded', 'max_tokens'],
            [null, 'end']
        ])('maps stop reason %s to %s', async (anthropic, expected) => {
            mockStream.mockReturnValue(
                sdkStream([], finalMessage({ stop_reason: anthropic }))
            );

            const events = await drain(
                createAnthropicProvider(config).stream(request)
            );

            expect(events.at(-1)).toMatchObject({ stopReason: expected });
        });

        it('ends with `aborted` rather than throwing when the caller cancels', async () => {
            const controller = new AbortController();
            mockStream.mockImplementation(() => {
                controller.abort();
                throw Object.assign(new Error('aborted'), {
                    name: 'AbortError'
                });
            });

            const events = await drain(
                createAnthropicProvider(config).stream(
                    request,
                    controller.signal
                )
            );

            expect(events).toEqual([
                {
                    type: 'done',
                    stopReason: 'aborted',
                    usage: { inputTokens: 0, outputTokens: 0 }
                }
            ]);
        });

        it('keeps the partial answer when the assembled message rejects', async () => {
            // The deltas are already out and already in the engine's
            // `assistantBlocks`, so the throw costs the reason for stopping,
            // not the text: the engine persists the partial turn as `error`.
            const events: ModelStreamEvent[] = [];
            mockStream.mockReturnValue({
                async *[Symbol.asyncIterator]() {
                    yield textDelta('Half an ');
                },
                finalMessage: () => Promise.reject(new Error('529 overloaded'))
            });

            await expect(
                (async () => {
                    for await (const event of createAnthropicProvider(
                        config
                    ).stream(request)) {
                        events.push(event);
                    }
                })()
            ).rejects.toThrow('529 overloaded');
            expect(events).toEqual([{ type: 'text-delta', text: 'Half an ' }]);
        });

        it('re-throws a genuine API failure instead of swallowing it', async () => {
            mockStream.mockImplementation(() => {
                throw new Error('529 overloaded');
            });

            await expect(
                drain(createAnthropicProvider(config).stream(request))
            ).rejects.toThrow('529 overloaded');
        });
    });

    describe('request construction', () => {
        beforeEach(() => {
            mockStream.mockReturnValue(sdkStream([], finalMessage()));
        });

        it('passes no `thinking` configuration', async () => {
            await drain(createAnthropicProvider(config).stream(request));

            // Disabling thinking makes the model occasionally write a tool call
            // into its visible text, where it silently never runs — the worst
            // failure mode there is for a tool-driven copilot.
            expect(lastParams()).not.toHaveProperty('thinking');
        });

        it('passes no sampling parameters', async () => {
            await drain(createAnthropicProvider(config).stream(request));

            expect(lastParams()).not.toHaveProperty('temperature');
            expect(lastParams()).not.toHaveProperty('top_p');
            expect(lastParams()).not.toHaveProperty('top_k');
        });

        it('defaults to the first declared model, and honours a per-request override', async () => {
            const provider = createAnthropicProvider(config);

            await drain(provider.stream(request));
            expect(lastParams()['model']).toBe('claude-opus-5');

            await drain(
                provider.stream({ ...request, model: 'claude-haiku-4-5' })
            );
            expect(lastParams()['model']).toBe('claude-haiku-4-5');
        });

        it('rejects a model this provider does not offer', async () => {
            // Silently answering on the default would bill the wrong budget
            // and make the transcript a lie about what produced the answer.
            await expect(
                drain(
                    createAnthropicProvider(config).stream({
                        ...request,
                        model: 'gpt-4o'
                    })
                )
            ).rejects.toThrow(/not offered by this copilot provider/);
        });

        it('sends effort only when configured', async () => {
            await drain(createAnthropicProvider(config).stream(request));
            expect(lastParams()).not.toHaveProperty('output_config');

            await drain(
                createAnthropicProvider({ ...config, effort: 'xhigh' }).stream(
                    request
                )
            );
            expect(lastParams()['output_config']).toEqual({ effort: 'xhigh' });
        });

        it('translates tools and block-structured turns onto the wire shape', async () => {
            await drain(
                createAnthropicProvider(config).stream({
                    system: 'You are the copilot.',
                    messages: [
                        {
                            role: 'assistant',
                            content: [
                                {
                                    type: 'tool_use',
                                    id: 'toolu_1',
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
                                    toolUseId: 'toolu_1',
                                    content: 'nothing found',
                                    isError: true
                                }
                            ]
                        }
                    ],
                    tools: [
                        {
                            name: 'search',
                            description: 'Search entries',
                            inputSchema: { type: 'object' }
                        }
                    ],
                    maxOutputTokens: 512
                })
            );

            expect(lastParams()).toMatchObject({
                // A block array rather than a bare string: that is what carries
                // the cache breakpoint. See the prompt-caching suite below.
                system: [{ type: 'text', text: 'You are the copilot.' }],
                max_tokens: 512,
                tools: [
                    {
                        name: 'search',
                        description: 'Search entries',
                        input_schema: { type: 'object' }
                    }
                ],
                messages: [
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'toolu_1',
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
                                tool_use_id: 'toolu_1',
                                content: 'nothing found',
                                is_error: true
                            }
                        ]
                    }
                ]
            });
        });

        it('omits the tools key entirely when the run offers none', async () => {
            await drain(createAnthropicProvider(config).stream(request));

            expect(lastParams()).not.toHaveProperty('tools');
        });
    });

    describe('prompt caching', () => {
        beforeEach(() => {
            mockStream.mockReturnValue(sdkStream([], finalMessage()));
        });

        /** The `cache_control` marker, or `undefined`, on a request's system. */
        function systemBreakpoint(): unknown {
            const system = lastParams()['system'] as
                | { cache_control?: unknown }[]
                | string;
            return typeof system === 'string'
                ? undefined
                : system.at(-1)?.cache_control;
        }

        /** Indices of the messages whose last block carries a breakpoint. */
        function messageBreakpoints(): number[] {
            const messages = lastParams()['messages'] as {
                content: { cache_control?: unknown }[];
            }[];
            return messages
                .map((message, index) =>
                    message.content.at(-1)?.cache_control ? index : -1
                )
                .filter((index) => index >= 0);
        }

        /** A run of `count` steps: one tool call and its result per step. */
        function loopOf(count: number): ModelRequest {
            // Mutable while it is being built; `ModelRequest['messages']` is
            // readonly, which is the contract the caller gets, not the builder.
            const messages: ModelRequest['messages'][number][] = [
                { role: 'user', content: [{ type: 'text', text: 'go' }] }
            ];
            for (let step = 0; step < count; step += 1) {
                messages.push({
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: `toolu_${step}`,
                            name: 'search',
                            input: { q: step }
                        }
                    ]
                });
                messages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            toolUseId: `toolu_${step}`,
                            content: 'ok'
                        }
                    ]
                });
            }
            return {
                system: 'You are the copilot.',
                messages,
                maxOutputTokens: 512
            };
        }

        it('caches the static prefix on the system block, which covers the tools', async () => {
            // Render order is tools -> system -> messages, so one breakpoint at
            // the end of system caches both. That prefix is identical on every
            // step of a run, and it is the expensive half.
            await drain(
                createAnthropicProvider(config).stream({
                    ...request,
                    system: 'You are the copilot.',
                    tools: [
                        {
                            name: 'search',
                            description: 'Search entries',
                            inputSchema: { type: 'object' }
                        }
                    ]
                })
            );

            expect(systemBreakpoint()).toEqual({ type: 'ephemeral' });
            // Not on the tools as well — that would spend a second breakpoint
            // on a prefix the system block already covers.
            const tools = lastParams()['tools'] as Record<string, unknown>[];
            expect(tools[0]).not.toHaveProperty('cache_control');
        });

        it('falls back to the last tool when the run has no system prompt', async () => {
            // Without a system block the tools ARE the end of the static
            // prefix, and marking one of them is the only way to cache them.
            await drain(
                createAnthropicProvider(config).stream({
                    ...request,
                    tools: [
                        {
                            name: 'search',
                            description: 'Search entries',
                            inputSchema: { type: 'object' }
                        },
                        {
                            name: 'read',
                            description: 'Read an entry',
                            inputSchema: { type: 'object' }
                        }
                    ]
                })
            );

            const tools = lastParams()['tools'] as Record<string, unknown>[];
            expect(tools[0]).not.toHaveProperty('cache_control');
            expect(tools[1]['cache_control']).toEqual({ type: 'ephemeral' });
        });

        it('rolls a breakpoint onto the newest turn, so the next step reads it', async () => {
            await drain(createAnthropicProvider(config).stream(loopOf(2)));

            const messages = lastParams()['messages'] as unknown[];
            expect(messageBreakpoints()).toContain(messages.length - 1);
        });

        it('keeps every breakpoint within the API\u2019s 20-block lookback', async () => {
            // A breakpoint walks back at most 20 content blocks looking for the
            // previous entry; past that it misses silently and the run pays
            // full price with no error to notice. A long run must therefore
            // carry intermediate breakpoints, not just one on the newest turn.
            //
            // Sized to fit the three-breakpoint budget, so every gap is
            // measurable inside this one request. Past that the chain is
            // carried BETWEEN requests instead — the oldest breakpoint of step
            // n reaches the entry a breakpoint of step n-1 wrote — which is the
            // same rule, but not a property one request can be asked about.
            await drain(createAnthropicProvider(config).stream(loopOf(20)));

            const messages = lastParams()['messages'] as {
                content: unknown[];
            }[];
            const blocksBefore = (index: number) =>
                messages
                    .slice(0, index)
                    .reduce((sum, message) => sum + message.content.length, 0);

            const gaps = messageBreakpoints()
                .map(blocksBefore)
                .sort((a, b) => a - b)
                .map((position, index, positions) =>
                    index === 0 ? position : position - positions[index - 1]
                );
            expect(Math.max(...gaps)).toBeLessThan(20);
        });

        it('never exceeds the API\u2019s four-breakpoint ceiling', async () => {
            // Five would be a 400 on every single request.
            await drain(createAnthropicProvider(config).stream(loopOf(60)));

            expect(messageBreakpoints().length + 1).toBeLessThanOrEqual(4);
        });

        it('sends no cache_control at all when the host opts out', async () => {
            // The escape hatch for a gateway that rejects the field. Opting out
            // must also put `system` back to a bare string.
            await drain(
                createAnthropicProvider({
                    ...config,
                    promptCaching: false
                }).stream(loopOf(3))
            );

            expect(lastParams()['system']).toBe('You are the copilot.');
            expect(messageBreakpoints()).toEqual([]);
        });
    });

    describe('models', () => {
        it('advertises every declared model, in order', () => {
            expect(createAnthropicProvider(config).models()).toEqual([
                'claude-opus-5',
                'claude-haiku-4-5'
            ]);
        });
    });

    describe('capabilities', () => {
        it('probes the Models API and caches the result', async () => {
            mockRetrieve.mockResolvedValue({
                id: 'claude-opus-5',
                max_input_tokens: 1_000_000,
                max_tokens: 64_000,
                capabilities: { image_input: { supported: true } }
            });
            const provider = createAnthropicProvider(config);

            await expect(provider.capabilities()).resolves.toEqual({
                model: 'claude-opus-5',
                toolCalling: true,
                streaming: true,
                vision: true,
                contextWindow: 1_000_000,
                maxOutputTokens: 64_000
            });

            await provider.capabilities();
            expect(mockRetrieve).toHaveBeenCalledTimes(1);
        });

        it('probes each model separately, caching them independently', async () => {
            mockRetrieve.mockImplementation((model: string) =>
                Promise.resolve({
                    id: model,
                    max_input_tokens: 200_000,
                    max_tokens: 8_192,
                    capabilities: { image_input: { supported: true } }
                })
            );
            const provider = createAnthropicProvider(config);

            await provider.capabilities('claude-opus-5');
            await provider.capabilities('claude-haiku-4-5');
            await provider.capabilities('claude-haiku-4-5');

            expect(mockRetrieve).toHaveBeenCalledTimes(2);
            await expect(
                provider.capabilities('claude-haiku-4-5')
            ).resolves.toMatchObject({ model: 'claude-haiku-4-5' });
        });

        it('re-probes after a failure instead of pinning the fallback', async () => {
            // The failed probe used to be cached like an answer, so a blip at
            // the wrong moment left the adapter reporting the conservative
            // record for the life of the process — the network came back and
            // nothing noticed.
            mockRetrieve.mockRejectedValueOnce(new Error('ENOTFOUND'));
            const provider = createAnthropicProvider(config);

            await expect(provider.capabilities()).resolves.toMatchObject({
                contextWindow: 200_000
            });

            mockRetrieve.mockResolvedValue({
                id: 'claude-opus-5',
                max_input_tokens: 1_000_000,
                max_tokens: 64_000,
                capabilities: { image_input: { supported: true } }
            });

            await expect(provider.capabilities()).resolves.toMatchObject({
                contextWindow: 1_000_000
            });
            expect(mockRetrieve).toHaveBeenCalledTimes(2);
        });

        it('shares one in-flight probe between concurrent callers', async () => {
            mockRetrieve.mockResolvedValue({
                id: 'claude-opus-5',
                max_input_tokens: 200_000,
                max_tokens: 8_192,
                capabilities: { image_input: { supported: true } }
            });
            const provider = createAnthropicProvider(config);

            // The promise is cached before it resolves, deliberately: two runs
            // asking at once must not pay for two probes.
            await Promise.all([
                provider.capabilities(),
                provider.capabilities()
            ]);

            expect(mockRetrieve).toHaveBeenCalledTimes(1);
        });

        it('falls back conservatively when the probe fails', async () => {
            mockRetrieve.mockRejectedValue(new Error('ENOTFOUND'));

            // Reporting "unknown" as "unsupported" would drop a frontier model
            // into degraded mode over a transient network blip.
            await expect(
                createAnthropicProvider(config).capabilities()
            ).resolves.toEqual({
                model: 'claude-opus-5',
                toolCalling: true,
                streaming: true,
                vision: true,
                contextWindow: 200_000,
                maxOutputTokens: 8_192
            });
        });
    });
});
