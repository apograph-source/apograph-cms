/** The copilot — its kill switch, its run ceilings, and its model backends. */
import type { CopilotPluginConfig } from '@orthacms/copilot-server';
import type { AnthropicProviderConfig } from '@orthacms/copilot-provider-anthropic';
import type { OpenAiProviderConfig } from '@orthacms/copilot-provider-openai';

import {
    defined,
    readEnv,
    readFlag,
    readList,
    readOptionalPositiveInt,
    readPositiveInt,
    when
} from '@orthacms/utils-server';

/**
 * Copilot settings, plus the connection settings for the model backends this
 * deployment can reach.
 *
 * The provider settings live **here**, not in `CopilotPluginConfig`: the
 * plugin is adapter-agnostic by decision (ADR-0004 §2), so it names no
 * provider kind. This file already imports the adapter factories in
 * `plugins.ts`, so importing their config types costs no new coupling — and
 * adding a fourth backend is a key here plus a line there, with nothing to
 * change inside the copilot packages.
 *
 * Each key is the name runs refer to the provider by. Register two of the same
 * kind freely (`ollamaFast`, `ollamaBig`); each declares its own model list.
 *
 * **A key is present only when the deployment configured that backend**, and
 * `plugins.ts` registers exactly the ones that are. There is no
 * `defaultProvider` naming one of them: the registered list *is* the setting,
 * its first entry serves a run that names none, and the admin's picker opens on
 * it. A name in a variable could be misspelled, could point at a backend nobody
 * registered, and had to be kept in step with the list on every change — while
 * "configured" is a fact this file can read directly.
 */
export interface OrthaCopilotConfig extends CopilotPluginConfig {
    /**
     * Model backends, keyed by the name they are registered under, in
     * preference order. Each is absent unless its connection settings are
     * present — a keyless clone gets neither, and therefore no copilot at all.
     * There is no scripted fallback: `plugins.ts` registers exactly what is
     * configured here, so `COPILOT_ENABLED=true` with nothing configured fails
     * at boot rather than answering every question with a canned sentence.
     */
    providers: {
        /** Native Claude. Present when `ANTHROPIC_API_KEY` is set. */
        claude?: AnthropicProviderConfig;
        /**
         * An OpenAI-wire-format endpoint — a local Ollama, vLLM, LiteLLM,
         * Azure or OpenAI itself. Present when `COPILOT_OPENAI_BASE_URL` is
         * set: an endpoint nobody named is a backend that can only time out,
         * and offering it in the picker would be worse than not having it.
         */
        ollama?: OpenAiProviderConfig;
    };
}

/** The copilot kill switch, its run ceilings, and the backends it can reach. */
export function copilotConfig(): OrthaCopilotConfig {
    return defined({
        // Off by default (ADR-0005 §10). Enabling a hosted provider sends
        // workspace content to a third party, so an operator opts in.
        enabled: readFlag('COPILOT_ENABLED', false),
        maxOutputTokens: readPositiveInt('COPILOT_MAX_OUTPUT_TOKENS', 8_192),
        limits: copilotLimits(),
        providers: copilotProviders()
    });
}

/**
 * The copilot's run ceilings, or nothing at all when the deployment set none.
 *
 * Each key is dropped rather than passed as `undefined`, because the engine
 * merges `{ ...DEFAULT_RUN_LIMITS, ...config.limits }` — an explicit `undefined`
 * erases the default instead of leaving it. The whole object goes away when
 * nothing is set, so an untouched `.env` leaves the plugin's defaults visible
 * rather than pinning them here.
 *
 * All three are exposed, not just `maxSteps`. They are checked in the same
 * loop, so an operator who raises one alone moves the wall rather than lifting
 * it: a run given more steps but the same wall clock stops on `timeout`
 * instead, which reads to the user as the same truncated answer. Zero is
 * rejected rather than silently ignored — `maxSteps: 0` skips the run loop
 * entirely, yielding a thread that shows a question and then silence, which is
 * why `CopilotPlugin` refuses it at construction too.
 *
 * Raising these costs tokens rather than safety — every step is still
 * authorized and audited, and a `propose` tool still writes its row before it
 * writes anything else.
 */
function copilotLimits(): CopilotPluginConfig['limits'] | undefined {
    const limits = defined({
        maxSteps: readOptionalPositiveInt('COPILOT_MAX_STEPS'),
        wallClockMs: readOptionalPositiveInt('COPILOT_WALL_CLOCK_MS'),
        maxTotalTokens: readOptionalPositiveInt('COPILOT_MAX_TOTAL_TOKENS')
    });
    return when(Object.keys(limits).length > 0, () => limits);
}

/**
 * The model backends this deployment can actually reach, in preference order.
 *
 * Each is here only if it was configured. Registering one that cannot answer
 * used to be harmless because `COPILOT_PROVIDER` decided who served a run; now
 * the first registered provider does, so a keyless `claude` sitting at the top
 * of the list would be the default and would fail on the first message. Absent
 * instead, it is not in the catalogue, not in the picker, and not a default
 * anybody has to override.
 */
function copilotProviders(): OrthaCopilotConfig['providers'] {
    const anthropicApiKey = readEnv('ANTHROPIC_API_KEY');
    const openAiBaseUrl = readEnv('COPILOT_OPENAI_BASE_URL');
    return defined({
        claude: when(anthropicApiKey, () =>
            defined({
                apiKey: anthropicApiKey as string,
                // Stable product configuration, so literals like the i18n
                // locales. First is the default; the rest are what a user can
                // switch to mid-conversation. Comma-separated env override for
                // pinning a different set without a redeploy.
                models: readList(
                    'COPILOT_ANTHROPIC_MODELS',
                    'claude-opus-5,claude-sonnet-5,claude-haiku-4-5'
                ),
                baseUrl: readEnv('ANTHROPIC_BASE_URL')
            })
        ),
        ollama: when(openAiBaseUrl, () => ({
            // A local Ollama is http://localhost:11434/v1 — point it at vLLM,
            // LiteLLM, Azure or OpenAI instead. No default: an unset variable
            // means "this deployment has no such backend", not "assume one is
            // running on this laptop".
            baseUrl: openAiBaseUrl as string,
            models: readList('COPILOT_OPENAI_MODELS', 'llama3.1'),
            apiKey: readEnv('COPILOT_OPENAI_API_KEY') ?? ''
        }))
    });
}
