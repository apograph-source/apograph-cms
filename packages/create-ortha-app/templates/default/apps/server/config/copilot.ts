/** The copilot kill switch and the model backends it can reach. */
import type { CopilotPluginConfig } from '@orthacms/copilot-server';
// ortha:if copilot-anthropic
import type { AnthropicProviderConfig } from '@orthacms/copilot-provider-anthropic';
// ortha:end
// ortha:if copilot-openai
import type { OpenAiProviderConfig } from '@orthacms/copilot-provider-openai';
// ortha:end
import { defined, readFlag, readPositiveInt } from '@orthacms/utils-server';

// ortha:if copilot-anthropic
import { anthropicProvider } from './copilot-anthropic';
// ortha:end
// ortha:if copilot-openai
import { openAiProvider } from './copilot-openai';
// ortha:end

/**
 * Copilot settings plus the backends this deployment can reach.
 *
 * The provider settings live **here**, not inside `CopilotPluginConfig`: the
 * plugin is adapter-agnostic by decision, so it names no provider kind. A key
 * is present only when the deployment configured that backend, and `plugins.ts`
 * registers exactly the ones that are — "configured" is a fact this file can
 * read, where a `defaultProvider` naming one of them could be misspelled or
 * point at a backend nobody registered.
 */
export interface AppCopilotConfig extends CopilotPluginConfig {
    providers: {
        // ortha:if copilot-anthropic
        /** Native Claude. Present when ANTHROPIC_API_KEY is set. */
        claude?: AnthropicProviderConfig;
        // ortha:end
        // ortha:if copilot-openai
        /**
         * An OpenAI-wire endpoint — Ollama, vLLM, LiteLLM, Azure or OpenAI.
         * Present when COPILOT_OPENAI_BASE_URL is set: an endpoint nobody
         * named is a backend that can only time out.
         */
        openai?: OpenAiProviderConfig;
        // ortha:end
    };
}

/** The copilot kill switch and the model backends it can reach. */
export function copilotConfig(): AppCopilotConfig {
    return {
        // Off by default: enabling a hosted provider sends workspace content to
        // a third party, which is an operator's decision to make explicitly.
        enabled: readFlag('COPILOT_ENABLED', false),
        maxOutputTokens: readPositiveInt('COPILOT_MAX_OUTPUT_TOKENS', 8192),
        providers: defined({
            // ortha:if copilot-anthropic
            claude: anthropicProvider(),
            // ortha:end
            // ortha:if copilot-openai
            openai: openAiProvider()
            // ortha:end
        })
    };
}
