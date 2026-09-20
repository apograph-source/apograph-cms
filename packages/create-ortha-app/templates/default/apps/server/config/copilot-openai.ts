// ortha:if copilot-openai
import type { OpenAiProviderConfig } from '@orthacms/copilot-provider-openai';
import { readEnv, readList } from '@orthacms/utils-server';

/**
 * An OpenAI-wire backend, or nothing. No default endpoint: an unset variable
 * means "this deployment has no such backend", not "assume one is running on
 * this laptop".
 */
export function openAiProvider(): OpenAiProviderConfig | undefined {
    const baseUrl = readEnv('COPILOT_OPENAI_BASE_URL');
    if (!baseUrl) {
        return undefined;
    }
    return {
        baseUrl,
        apiKey: readEnv('COPILOT_OPENAI_API_KEY') ?? '',
        models: readList('COPILOT_OPENAI_MODELS', 'llama3.1')
    };
}
// ortha:end
