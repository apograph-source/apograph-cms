import {
    UnknownModelProviderError,
    type ModelChoice,
    type ModelProvider,
    type ModelRegistry
} from '@orthacms/copilot-domain';

/** One provider the host offers, under the name runs refer to it by. */
export interface ProviderRegistration {
    /** Unique, operator-chosen name — `claude`, `ollama-big`, `local`. */
    name: string;
    /** The adapter instance, already constructed with its own config. */
    provider: ModelProvider;
}

/**
 * Builds an immutable {@link ModelRegistry} over the host's provider list.
 * Bound to `MODEL_REGISTRY` at the composition root; the resolver returns a
 * name, the core looks the provider up here.
 *
 * Registration order is preserved, so {@link ModelRegistry.catalogue} renders
 * in the order the operator wrote — the first entry reads as the house default.
 *
 * @throws When a name is blank or registered twice. A list can express both,
 *   unlike a map, so the guard has to be explicit — and silently dropping one
 *   of two same-named providers would route runs to a backend nobody chose.
 */
export function buildModelRegistry(
    registrations: readonly ProviderRegistration[]
): ModelRegistry {
    // Snapshot into a **null-prototype** object so a later mutation of the
    // host's list can't reroute a run mid-flight, and a lookup of
    // `constructor`/`toString` misses instead of resolving something off
    // `Object.prototype` that is not a provider.
    const entries: Record<string, ModelProvider> = Object.create(
        null
    ) as Record<string, ModelProvider>;
    const order: string[] = [];

    for (const { name, provider } of registrations) {
        if (!name.trim()) {
            throw new Error(
                'Every copilot model provider needs a non-empty name — it is what a run, and a resolver, refer to it by.'
            );
        }
        if (Object.prototype.hasOwnProperty.call(entries, name)) {
            throw new Error(
                `Duplicate copilot model provider name "${name}". Names must be unique across the provider list.`
            );
        }
        entries[name] = provider;
        order.push(name);
    }

    return {
        get(name: string): ModelProvider {
            const provider = entries[name];
            if (!provider) {
                throw new UnknownModelProviderError(name, [...order]);
            }
            return provider;
        },
        has(name: string): boolean {
            return Object.prototype.hasOwnProperty.call(entries, name);
        },
        names(): string[] {
            return [...order];
        },
        catalogue(): ModelChoice[] {
            return order.flatMap((name) =>
                entries[name]
                    .models()
                    .map((model) => ({ provider: name, model }))
            );
        }
    };
}
