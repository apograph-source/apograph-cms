/**
 * The **virtual filter-field registry** — how more than one plugin contributes
 * fields to a content type's `?filter=` surface.
 *
 * `CONTENT_ENTRY_EXTENSION.filterExtension` already declares virtual fields
 * (i18n's `hasLocale` / `missingLocale` / `localeCount`), but that port is a
 * documented **single binding**: one provider per app, and i18n holds it. Nest
 * has no multi-provider, so a second plugin binding the token would silently
 * replace the first — for a filter surface that means fields quietly vanishing
 * from the picker and saved filters starting to 400.
 *
 * So a plugin registers here instead (`@orthacms/segments-server` contributes
 * "can be seen by" / "cannot be seen by" / "restricted"), the same shape and the
 * same reason as `contentReadScopeRegistrar`. The bound extension keeps its
 * method; {@link EntryFilterProviderRegistry.compose} folds the two together
 * into the one `EntryFilterExtension` the query path already knows how to use,
 * so nothing downstream changed.
 *
 * ## What a contribution owes
 *
 * **Every emitted subquery MUST scope to the workspace it is handed.** A virtual
 * field is a subquery over a table this package knows nothing about; one that
 * forgets the workspace turns a filter into a cross-tenant read.
 *
 * **Only declare fields you can answer, with only the operators you support.**
 * The declared `fields` become the SQL whitelist, so an operator the resolver
 * refuses reaches the user as "couldn't load this collection" over a rule the
 * picker itself proposed. Narrow the operator set in the admin's `FilterField`
 * to match.
 *
 * **A filter narrows what is listed; it is not a visibility rule.** Reachability
 * is `CONTENT_READ_SCOPE`'s job and is applied separately. A field here must not
 * be relied on to hide anything.
 */

import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type Provider,
    type Type
} from '@nestjs/common';
import type { FieldSchema } from '@orthacms/utils-server';
import type { AnyContentType } from '../types/content-type';
import type { EntryFilterExtension } from './entry-extension';

/** One plugin's virtual filter fields. */
export interface EntryFilterProvider {
    /**
     * The fields this plugin adds to `type`'s filter surface, or `undefined`
     * when it adds none — which is what a plugin that is installed but
     * unconfigured must return, so a bare install pays nothing.
     */
    filterFor(type: AnyContentType): EntryFilterExtension | undefined;
}

/** Every registered provider, in registration order. */
@Injectable()
export class EntryFilterProviderRegistry {
    private readonly logger = new Logger(EntryFilterProviderRegistry.name);
    private readonly providers: EntryFilterProvider[] = [];

    /** Adds a provider. Registering the same instance twice is a no-op. */
    register(provider: EntryFilterProvider): void {
        if (!this.providers.includes(provider)) {
            this.providers.push(provider);
        }
    }

    /**
     * Fold the bound extension's contribution and every registered provider's
     * into one {@link EntryFilterExtension}.
     *
     * Returns `undefined` when nobody contributed anything, so a type with no
     * virtual fields builds exactly the surface it did before this registry
     * existed — and `entries.service` keeps its "no extension, no
     * `resolveExtension`" branch.
     *
     * `resolve` routes by the rule's **field name**, to whoever declared it.
     * A name declared twice is kept by its first declarer and the duplicate is
     * dropped with a warning: silently letting the last writer win would make
     * the meaning of a saved filter depend on plugin registration order.
     */
    compose(
        type: AnyContentType,
        bound: EntryFilterExtension | undefined
    ): EntryFilterExtension | undefined {
        const contributions = [
            ...(bound ? [bound] : []),
            ...this.providers
                .map((provider) => provider.filterFor(type))
                .filter((entry): entry is EntryFilterExtension => !!entry)
        ];
        if (!contributions.length) return undefined;
        if (contributions.length === 1) return contributions[0];

        const fields: FieldSchema = {};
        const owners = new Map<string, EntryFilterExtension>();
        for (const contribution of contributions) {
            for (const [name, spec] of Object.entries(contribution.fields)) {
                if (owners.has(name)) {
                    this.logger.warn(
                        `Two plugins declare the filter field "${name}" on "${type.name}"; keeping the first.`
                    );
                    continue;
                }
                owners.set(name, contribution);
                fields[name] = spec;
            }
        }

        return {
            fields,
            resolve: (rule, context) => {
                const owner = owners.get(rule.path[0]);
                if (!owner) {
                    // Unreachable through the parser — a rule only gets here
                    // after its name was whitelisted from `fields` above — but a
                    // thrown error beats a silently-true predicate if it ever is.
                    throw new Error(
                        `No provider owns the filter field "${rule.path[0]}".`
                    );
                }
                return owner.resolve(rule, context);
            }
        };
    }
}

/** Registers a plugin's filter providers with content at bootstrap. */
class EntryFilterBootstrapper implements OnApplicationBootstrap {
    private readonly logger = new Logger(EntryFilterBootstrapper.name);

    constructor(
        private readonly label: string,
        private readonly registry: EntryFilterProviderRegistry | null,
        private readonly providers: readonly EntryFilterProvider[]
    ) {}

    onApplicationBootstrap(): void {
        // A deployment without `ContentPlugin` is not a real configuration, but
        // a binding plugin should still boot rather than fail on an injection it
        // cannot influence.
        if (!this.registry) return;
        for (const provider of this.providers) {
            this.registry.register(provider);
        }
        this.logger.log(
            `Registered the ${this.label} filter fields with content.`
        );
    }
}

/**
 * Builds the DI provider that registers `providers` with content's filter-field
 * registry at bootstrap.
 *
 * A factory with an explicit `inject` list rather than a class with reflected
 * parameters, for the reason `contentReadScopeRegistrar` documents: an optional
 * dependency typed `Foo | null` emits `Object` for `design:paramtypes`, Nest
 * injects `undefined` with no error, and the plugin registers nothing.
 */
export function entryFilterProviderRegistrar(
    label: string,
    ...providers: Type<EntryFilterProvider>[]
): Provider {
    return {
        provide: `ENTRY_FILTER_PROVIDER_REGISTRAR_${label.toUpperCase()}`,
        useFactory: (
            registry: EntryFilterProviderRegistry | null,
            ...resolved: EntryFilterProvider[]
        ) => new EntryFilterBootstrapper(label, registry, resolved),
        inject: [
            { token: EntryFilterProviderRegistry, optional: true },
            ...providers
        ]
    };
}
