import {
    UnknownSsoProviderError,
    type SsoProvider,
    type SsoProviderSummary,
    type SsoRegistration,
    type SsoRegistry
} from '@orthacms/identity-domain';

/**
 * Builds an immutable {@link SsoRegistry} over the host's provider list. Bound
 * to `SSO_REGISTRY` at the composition root; the route names a provider, this
 * is where the adapter is found.
 *
 * Registration order is preserved, because that is the order the sign-in page
 * renders its buttons in. Unlike the copilot's model registry there is no
 * "first is the default" rule — a person picks a button, so order is
 * presentation and nothing more.
 *
 * @throws When a name is blank, registered twice, or not route-safe. A list can
 *   express all three, unlike a map, and each would fail somewhere far from the
 *   line that caused it: a blank name yields an unreachable route, a duplicate
 *   silently drops one adapter, and a name with a slash or a percent in it
 *   makes `/api/auth/sso/:provider/start` mean something other than what the
 *   operator wrote.
 */
export function buildSsoRegistry(
    registrations: readonly SsoRegistration[]
): SsoRegistry {
    // Snapshot into a **null-prototype** object so a later mutation of the
    // host's array cannot reroute a sign-in, and so a lookup of `constructor`
    // or `toString` misses rather than resolving something off
    // `Object.prototype` that is not a provider.
    const entries: Record<string, SsoProvider> = Object.create(null) as Record<
        string,
        SsoProvider
    >;
    const order: string[] = [];

    for (const { name, provider } of registrations) {
        if (!name.trim()) {
            throw new Error(
                'Every SSO provider needs a non-empty name — it is what the sign-in route, and every link row, refer to it by.'
            );
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
            throw new Error(
                `SSO provider name "${name}" is not usable in a URL path. Use lower-case letters, digits and hyphens (e.g. "entra-id").`
            );
        }
        if (Object.prototype.hasOwnProperty.call(entries, name)) {
            throw new Error(
                `Duplicate SSO provider name "${name}". Names must be unique across the provider list — a link row records the name, so two adapters sharing one would resolve to whichever happened to win.`
            );
        }
        entries[name] = provider;
        order.push(name);
    }

    return {
        get(name: string): SsoProvider {
            const provider = entries[name];
            if (!provider) {
                throw new UnknownSsoProviderError(name, [...order]);
            }
            return provider;
        },
        has: (name: string): boolean =>
            Object.prototype.hasOwnProperty.call(entries, name),
        names: (): string[] => [...order],
        catalogue: (): SsoProviderSummary[] =>
            order.map((name) => {
                const { label, kind } = entries[name].descriptor();
                return { name, label, kind };
            })
    };
}
