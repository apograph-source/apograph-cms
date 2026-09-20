import {
    MODEL_PROVIDER_CONFORMANCE_CHECKS,
    runModelProviderConformance,
    type ModelProviderConformanceReport,
    type ModelRequest
} from '@orthacms/copilot-domain';
import type { FakeProvider } from './config';
import { createFakeProvider } from './fake-provider';

const MODELS = ['fake', 'fake-large'];
const ANSWER = 'I found 3 matching articles.';

const request: ModelRequest = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 1024
};

/**
 * The port's contract, driven identically against all three adapters
 * (`@orthacms/copilot-domain`'s conformance kit).
 *
 * This is the adapter every `server-e2e` suite runs against, so a divergence
 * here is a divergence between what CI proves and what production does — which
 * is how the mid-stream abort's partial usage survived: each adapter's own spec
 * only ever documented what that adapter happened to do.
 */
describe('ModelProvider conformance', () => {
    let report: ModelProviderConformanceReport;

    beforeAll(async () => {
        // The fake has no transport, so the analogue of "a request was issued"
        // is its own call log: a rejected model must neither record a call nor
        // advance the script.
        const built: FakeProvider[] = [];
        const build = (config: Parameters<typeof createFakeProvider>[0]) => {
            const provider = createFakeProvider(config);
            built.push(provider);
            return provider;
        };

        report = await runModelProviderConformance({
            text: () => ({
                provider: build({
                    models: MODELS,
                    script: [{ text: ANSWER }],
                    chunkSize: 4
                }),
                request,
                answer: ANSWER
            }),
            toolCall: () => ({
                provider: build({
                    models: MODELS,
                    script: [
                        {
                            toolCalls: [
                                {
                                    name: 'admin_content_search',
                                    input: { q: 'launch' }
                                }
                            ]
                        }
                    ]
                }),
                request
            }),
            unknownModel: 'gpt-4o',
            requestsIssued: () =>
                built.reduce(
                    (total, provider) => total + provider.calls.length,
                    0
                )
        });
    });

    // covers: copilot:I-22
    it.each(MODEL_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
