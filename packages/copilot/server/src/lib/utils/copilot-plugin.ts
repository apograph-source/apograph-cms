import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import {
    buildSkillRegistry,
    type ModelResolver,
    type SkillDefinition
} from '@orthacms/copilot-domain';
import { CopilotModule } from '../copilot.module';
import type { ProviderRegistration } from '../infrastructure/model-registry';
import type { CopilotPluginConfig } from '../types/copilot-config';

/** The copilot plugin shape, with its config attached. */
export type CopilotServerPluginDefinition = ServerPlugin & {
    copilotConfig: CopilotPluginConfig;
};

/** Options the host passes to {@link CopilotPlugin}. */
export interface CopilotPluginOptions {
    /**
     * The model backends this deployment can reach, in preference order. Each
     * entry pairs an operator-chosen name with an already-constructed adapter,
     * so the plugin never learns which adapters exist — register two of the
     * same kind (`ollama-fast`, `ollama-big`) freely.
     *
     * **The order is the setting.** The first entry serves any run that names
     * no provider, and is what the admin's model picker opens on. There is no
     * separate `defaultProvider` to name one of these — a name that could be
     * misspelled, could point at a provider nobody registered, and had to be
     * kept in step with this list on every change. A deployment that should
     * not reach a backend does not register it.
     *
     * **May be empty only while `config.enabled` is false.** A copilot that is
     * on and has nothing to call is a misconfiguration, and fails at
     * construction rather than on the first message.
     */
    providers: readonly ProviderRegistration[];
    /** Optional custom handler picking a provider per run (plain code). */
    resolve?: ModelResolver;
    /**
     * Skills defined **in code** — reusable instruction packets available in
     * every workspace of this deployment.
     *
     * Here rather than in `config` for the same reason the providers are: the
     * bodies are usually read off disk next to `plugins.ts`, and config is the
     * typed view of the environment. A workspace can author its own alongside
     * these in the CMS; a code skill wins a name collision, and is read-only in
     * the admin.
     */
    skills?: readonly SkillDefinition[];
    /** Host config (kill switch + output ceiling + run limits). */
    config: CopilotPluginConfig;
}

/**
 * Validate the wiring **eagerly** (like `ContentPlugin`'s registry and
 * `I18nServerPlugin`'s locales): a provider declaring no models, or an enabled
 * copilot with no provider at all, is a misconfiguration that should fail at
 * construction — before boot — rather than on the first chat message, where it
 * is most expensive to diagnose.
 *
 * **The empty list is only a misconfiguration when the copilot is on.** A
 * deployment that has not set `enabled` mounts no controllers and can serve no
 * run, so it needs no backend — and that is the ordinary state of a fresh
 * checkout, which configures no keys. There is no scripted offline adapter to
 * fall back on: the fake provider is a private test fixture, so a host with no
 * keys registers nothing rather than registering something that answers every
 * question with a canned sentence.
 *
 * Name uniqueness is enforced by `buildModelRegistry`, which the module builds
 * from the same list.
 */
function assertOptions(options: CopilotPluginOptions): void {
    const names = options.providers.map((entry) => entry.name);
    if (names.length === 0 && options.config.enabled) {
        throw new Error(
            'CopilotPlugin is enabled but has no model provider. Configure a backend and register it at ' +
                "the composition root, e.g. `providers: [{ name: 'claude', provider: createAnthropicProvider(…) }]` " +
                '— or leave the copilot off.'
        );
    }
    for (const entry of options.providers) {
        if (entry.provider.models().length === 0) {
            throw new Error(
                `Copilot model provider "${entry.name}" declares no models. Configure at least one.`
            );
        }
    }
    if (options.config.maxOutputTokens <= 0) {
        throw new Error(
            `CopilotPlugin's maxOutputTokens must be a positive number (got ${options.config.maxOutputTokens}).`
        );
    }
    // The ceilings, on the same terms. `maxSteps` is the one an operator
    // reaches for (`COPILOT_MAX_STEPS`), and it was the only number in this
    // config that could be set to something meaningless and still boot:
    // `maxSteps: 0` makes `for (step = 0; step < 0; …)` skip the loop entirely,
    // so the run yields `run-started` and then `done` with `max-steps` — no
    // model call, no answer, and no assistant row at all, leaving a thread
    // showing a question and silence. A typo'd env var should not be able to
    // turn the copilot into that.
    for (const [key, value] of Object.entries(options.config.limits ?? {})) {
        if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
            throw new Error(
                `CopilotPlugin's limits.${key} must be a positive number (got ${value}).`
            );
        }
    }
    // Built here and thrown away: the module builds its own from the same list.
    // The point is *when* — a malformed or duplicated skill fails at
    // construction, like a mistyped provider name, rather than on the first
    // chat message in the workspace that happened to use it.
    buildSkillRegistry(options.skills ?? []);
}

/**
 * Creates the copilot plugin. Register it **after** `WorkspacesPlugin` (runs
 * are workspace-scoped) and `IdentityPlugin` (runs execute as the calling
 * user, with the `copilot:use` permission checked by its guard). Model
 * providers are constructed at the composition root and passed in here — the
 * plugin never imports a vendor SDK, and never learns which adapters exist
 * ([ADR-0004](../../../../../docs/adr/0004-model-agnostic-copilot-provider.md) §1).
 *
 * **Phase 1 ships the chat vertical slice**: the SSE run route, the bounded run
 * engine, the capability profile, and the transcript tables this plugin now
 * owns and migrates.
 *
 * Each entry is a backend this deployment actually configured. An enabled
 * copilot needs at least one; a disabled one needs none, and a checkout with no
 * keys registers none.
 *
 * @example
 * ```typescript
 * CopilotPlugin({
 *     providers: [
 *         { name: 'claude', provider: createAnthropicProvider(providers.claude) },
 *         { name: 'ollama', provider: createOpenAiProvider(providers.ollama) }
 *     ],
 *     config: config.plugins.copilot
 * });
 * ```
 */
export function CopilotPlugin(
    options: CopilotPluginOptions
): CopilotServerPluginDefinition {
    assertOptions(options);
    return {
        name: 'copilot',
        module: CopilotModule.forRoot(options),
        copilotConfig: options.config,
        migrations: {
            // Lazy — only called at migrate time. Source layout: src/lib/utils
            // → ../../../migrations = <pkg>/migrations.
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_copilot'
        }
    };
}
