import {
    MODEL_PROVIDER_CONFORMANCE_CHECKS,
    runModelProviderConformance,
    type ModelProviderConformanceReport,
    type ModelRequest
} from '@orthacms/copilot-domain';
import { createOpenAiProvider } from './openai-provider';

const ANSWER = 'Hello there';

const request: ModelRequest = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxOutputTokens: 256
};

const provider = () =>
    createOpenAiProvider({
        baseUrl: 'http://localhost:11434/v1',
        models: ['llama3.1', 'qwen2.5']
    });

function abortError(): Error {
    return Object.assign(new Error('This operation was aborted'), {
        name: 'AbortError'
    });
}

/**
 * A stubbed endpoint whose body **observes the signal**, as a real socket does:
 * an already-aborted request rejects, and an abort mid-body errors the stream
 * rather than ending it cleanly. A stub that ignored the signal would let the
 * abort clauses pass without being exercised.
 */
function armFetch(chunks: unknown[]): void {
    const encoder = new TextEncoder();
    jest.mocked(globalThis.fetch).mockImplementation((_url, init) => {
        const signal = init?.signal ?? undefined;
        if (signal?.aborted) {
            return Promise.reject(abortError());
        }
        let index = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (signal?.aborted) {
                    controller.error(abortError());
                    return;
                }
                if (index >= chunks.length) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                    return;
                }
                const chunk = chunks[index];
                index += 1;
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
                );
            }
        });
        return Promise.resolve(
            new Response(body, {
                status: 200,
                headers: { 'content-type': 'text/event-stream' }
            })
        );
    });
}

/** The port's contract, driven identically against all three adapters. */
describe('ModelProvider conformance', () => {
    let report: ModelProviderConformanceReport;

    beforeAll(async () => {
        globalThis.fetch = jest.fn();

        report = await runModelProviderConformance({
            text: () => {
                armFetch([
                    { choices: [{ delta: { content: 'Hello' } }] },
                    { choices: [{ delta: { content: ' there' } }] },
                    { choices: [{ delta: {}, finish_reason: 'stop' }] },
                    {
                        choices: [],
                        usage: { prompt_tokens: 12, completion_tokens: 3 }
                    }
                ]);
                return { provider: provider(), request, answer: ANSWER };
            },
            toolCall: () => {
                armFetch([
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
                                            function: {
                                                arguments: '"launch"}'
                                            }
                                        }
                                    ]
                                },
                                finish_reason: 'tool_calls'
                            }
                        ]
                    }
                ]);
                return { provider: provider(), request };
            },
            unknownModel: 'gpt-4o',
            requestsIssued: () =>
                jest.mocked(globalThis.fetch).mock.calls.length
        });
    });

    // covers: copilot:I-22
    it.each(MODEL_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
