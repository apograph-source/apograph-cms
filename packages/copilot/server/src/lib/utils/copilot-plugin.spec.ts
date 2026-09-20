import type { ModelProvider } from '@orthacms/copilot-domain';
import { CopilotPlugin, type CopilotPluginOptions } from './copilot-plugin';
import type { CopilotPluginConfig } from '../types/copilot-config';

const provider = (models: string[] = ['m1']): ModelProvider => ({
    models: () => models,
    capabilities: () =>
        Promise.resolve({
            model: models[0],
            toolCalling: true,
            streaming: true,
            vision: false,
            contextWindow: 32_000,
            maxOutputTokens: 4_096
        }),
    // eslint-disable-next-line require-yield
    stream: async function* () {
        throw new Error('not called');
    }
});

const config = (
    overrides: Partial<CopilotPluginConfig> = {}
): CopilotPluginConfig => ({
    enabled: false,
    maxOutputTokens: 8_192,
    ...overrides
});

const options = (
    overrides: Partial<CopilotPluginOptions> = {}
): CopilotPluginOptions => ({
    providers: [{ name: 'claude', provider: provider() }],
    config: config(),
    ...overrides
});

/**
 * `CopilotPlugin` validates its wiring **eagerly** (like `I18nServerPlugin`'s
 * locales), so a misconfigured host fails at construction rather than on the
 * first chat message — the point where a broken default provider is most
 * expensive to diagnose.
 */
describe('CopilotPlugin config validation', () => {
    it('names the plugin "copilot" and carries its config', () => {
        const pluginConfig = config();
        const plugin = CopilotPlugin(options({ config: pluginConfig }));

        expect(plugin.name).toBe('copilot');
        expect(plugin.copilotConfig).toBe(pluginConfig);
    });

    // Phase 1 gave the plugin its own tables (conversations, messages, tool
    // calls), so it now ships migrations under its own tracking table — the
    // host applies them alongside every other plugin's.
    it('ships its migrations under its own tracking table', () => {
        const { migrations } = CopilotPlugin(options());

        expect(migrations?.table).toBe('__drizzle_migrations_copilot');
        // The dir is a thunk so the path resolves only at migrate time.
        expect(typeof migrations?.dir).toBe('function');
        expect(migrations?.dir()).toMatch(/migrations$/);
    });

    it('accepts a valid wiring', () => {
        expect(() => CopilotPlugin(options())).not.toThrow();
    });

    /**
     * The empty list is a misconfiguration only when the copilot is **on**.
     * There is no scripted offline adapter registered any more — the fake
     * provider is a private test fixture — so a checkout with no keys reaches
     * this constructor with nothing, and that is the ordinary state: the
     * kill switch is off, no controller is mounted, and no run can be served.
     * Booting it is right; booting an *enabled* copilot that has nothing to
     * call is not, and the message must arrive at construction rather than on
     * the first chat message.
     */
    it('accepts an empty provider list while the copilot is off', () => {
        expect(() =>
            CopilotPlugin(options({ providers: [], config: config() }))
        ).not.toThrow();
    });

    it('rejects an empty provider list once the copilot is on [copilot:I-35]', () => {
        expect(() =>
            CopilotPlugin(
                options({ providers: [], config: config({ enabled: true }) })
            )
        ).toThrow(/enabled but has no model provider/);
    });

    it('rejects a provider declaring no models [copilot:I-35]', () => {
        expect(() =>
            CopilotPlugin(
                options({
                    providers: [{ name: 'claude', provider: provider([]) }]
                })
            )
        ).toThrow(/"claude" declares no models/);
    });

    it('rejects a non-positive maxOutputTokens [copilot:I-35]', () => {
        expect(() =>
            CopilotPlugin(options({ config: config({ maxOutputTokens: 0 }) }))
        ).toThrow(/must be a positive number/);
    });

    it.each([
        ['maxSteps', 0],
        ['maxSteps', -1],
        ['wallClockMs', 0],
        ['maxTotalTokens', Number.NaN]
        // covers: copilot:I-35
    ])('rejects a non-positive limits.%s (%p)', (key, value) => {
        expect(() =>
            CopilotPlugin(
                options({ config: config({ limits: { [key]: value } }) })
            )
        ).toThrow(new RegExp(`limits\\.${key} must be a positive number`));
    });

    it('accepts a raised maxSteps — the one an operator actually sets', () => {
        expect(() =>
            CopilotPlugin(
                options({ config: config({ limits: { maxSteps: 20 } }) })
            )
        ).not.toThrow();
    });

    it('stays constructible while disabled — the kill switch is not a wiring error', () => {
        expect(() =>
            CopilotPlugin(options({ config: config({ enabled: false }) }))
        ).not.toThrow();
    });
});
