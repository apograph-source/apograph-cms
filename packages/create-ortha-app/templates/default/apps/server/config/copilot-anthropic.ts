// ortha:if copilot-anthropic
import type { AnthropicProviderConfig } from '@orthacms/copilot-provider-anthropic';
import { readEnv, readList } from '@orthacms/utils-server';

/**
 * Native Claude, or nothing.
 *
 * Setting the key is what REGISTERS this backend — leave it empty and there is
 * no `claude` in the picker at all, rather than one that fails on the first
 * message.
 */
export function anthropicProvider(): AnthropicProviderConfig | undefined {
    const apiKey = readEnv('ANTHROPIC_API_KEY');
    if (!apiKey) {
        return undefined;
    }
    return {
        apiKey,
        models: readList('COPILOT_ANTHROPIC_MODELS', 'claude-sonnet-5')
    };
}
// ortha:end
