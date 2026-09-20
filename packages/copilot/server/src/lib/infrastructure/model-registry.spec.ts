import {
    UnknownModelProviderError,
    type ModelProvider
} from '@orthacms/copilot-domain';
import { buildModelRegistry } from './model-registry';

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

describe('buildModelRegistry', () => {
    it('resolves a registered provider by name', () => {
        const claude = provider();
        const registry = buildModelRegistry([
            { name: 'claude', provider: claude }
        ]);

        expect(registry.get('claude')).toBe(claude);
        expect(registry.has('claude')).toBe(true);
        expect(registry.names()).toEqual(['claude']);
    });

    it('names the registered providers when asked for an unknown one', () => {
        const registry = buildModelRegistry([
            { name: 'claude', provider: provider() }
        ]);

        expect(() => registry.get('ollama')).toThrow(UnknownModelProviderError);
        expect(() => registry.get('ollama')).toThrow(
            /Unknown copilot model provider "ollama"\. Registered: claude/
        );
    });

    it('does not resolve inherited Object properties as providers', () => {
        const registry = buildModelRegistry([
            { name: 'fake', provider: provider() }
        ]);

        expect(registry.has('toString')).toBe(false);
        expect(() => registry.get('constructor')).toThrow(
            UnknownModelProviderError
        );
    });

    it('snapshots the list, so a later mutation cannot reroute a run', () => {
        const original = provider();
        const registrations = [{ name: 'fake', provider: original }];
        const registry = buildModelRegistry(registrations);

        registrations[0] = { name: 'fake', provider: provider() };
        registrations.push({ name: 'sneaky', provider: provider() });

        expect(registry.get('fake')).toBe(original);
        expect(registry.has('sneaky')).toBe(false);
    });

    it('rejects a duplicate name rather than silently dropping one', () => {
        // A list can express what a map cannot; routing runs to whichever
        // entry happened to win would be a backend nobody chose.
        expect(() =>
            buildModelRegistry([
                { name: 'ollama', provider: provider() },
                { name: 'ollama', provider: provider() }
            ])
        ).toThrow(/Duplicate copilot model provider name "ollama"/);
    });

    it('rejects a blank name', () => {
        expect(() =>
            buildModelRegistry([{ name: '  ', provider: provider() }])
        ).toThrow(/non-empty name/);
    });

    it('lists every provider x model pair in registration order', () => {
        const registry = buildModelRegistry([
            { name: 'claude', provider: provider(['opus', 'haiku']) },
            { name: 'ollama', provider: provider(['llama3.1']) }
        ]);

        expect(registry.catalogue()).toEqual([
            { provider: 'claude', model: 'opus' },
            { provider: 'claude', model: 'haiku' },
            { provider: 'ollama', model: 'llama3.1' }
        ]);
    });
});
