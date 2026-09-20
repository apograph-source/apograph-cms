import {
    MODEL_PROVIDER_CONFORMANCE_CHECKS,
    runModelProviderConformance,
    type ModelProviderConformanceReport,
    type ModelRequest
} from '@orthacms/copilot-domain';
import { createAnthropicProvider } from './anthropic-provider';

const mockStream = jest.fn();
const mockRetrieve = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        messages: { stream: mockStream },
        models: { retrieve: mockRetrieve }
    }))
}));

const ANSWER = 'Hello there';

const request: ModelRequest = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxOutputTokens: 1024
};

const config = {
    apiKey: 'sk-test',
    models: ['claude-opus-5', 'claude-haiku-4-5']
};

function abortError(): Error {
    return Object.assign(new Error('Request was aborted.'), {
        name: 'AbortError'
    });
}

/**
 * A stand-in for the SDK's `MessageStream` that **observes the signal**, as the
 * real one does: an aborted request rejects at construction, and an abort
 * arriving mid-iteration errors the iterator rather than ending it cleanly.
 * Without that the abort clauses would be checked against a stub that cannot
 * fail them.
 */
function armStream(events: unknown[], final: unknown): void {
    mockStream.mockImplementation(
        (_params: unknown, options?: { signal?: AbortSignal }) => {
            const signal = options?.signal;
            if (signal?.aborted) {
                throw abortError();
            }
            return {
                async *[Symbol.asyncIterator]() {
                    for (const event of events) {
                        if (signal?.aborted) {
                            throw abortError();
                        }
                        yield event;
                    }
                },
                finalMessage: () =>
                    signal?.aborted
                        ? Promise.reject(abortError())
                        : Promise.resolve(final)
            };
        }
    );
}

const textDelta = (text: string) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text }
});

/** The port's contract, driven identically against all three adapters. */
describe('ModelProvider conformance', () => {
    let report: ModelProviderConformanceReport;

    beforeAll(async () => {
        mockRetrieve.mockResolvedValue({
            id: 'claude-opus-5',
            max_input_tokens: 200_000,
            max_tokens: 8_192,
            capabilities: { image_input: { supported: true } }
        });

        report = await runModelProviderConformance({
            text: () => {
                armStream([textDelta('Hello'), textDelta(' there')], {
                    content: [],
                    stop_reason: 'end_turn',
                    usage: { input_tokens: 12, output_tokens: 3 }
                });
                return {
                    provider: createAnthropicProvider(config),
                    request,
                    answer: ANSWER
                };
            },
            toolCall: () => {
                armStream([], {
                    content: [
                        {
                            type: 'tool_use',
                            id: 'toolu_1',
                            name: 'admin_content_search',
                            input: { q: 'launch' }
                        }
                    ],
                    stop_reason: 'tool_use',
                    usage: { input_tokens: 12, output_tokens: 3 }
                });
                return { provider: createAnthropicProvider(config), request };
            },
            unknownModel: 'gpt-4o',
            requestsIssued: () => mockStream.mock.calls.length
        });
    });

    // covers: copilot:I-22
    it.each(MODEL_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
