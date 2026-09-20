import type { SQL } from 'drizzle-orm';
import { ScalarFieldType, type ParsedRule } from '@orthacms/utils-server';
import type { AnyContentType } from '../types/content-type';
import type {
    EntryFilterContext,
    EntryFilterExtension
} from './entry-extension';
import { EntryFilterProviderRegistry } from './entry-filter-provider';

const TYPE = { name: 'article' } as AnyContentType;
const CONTEXT = { type: TYPE, workspaceId: 'w1' } as EntryFilterContext;

/** A contribution declaring `names`, resolving to a marker naming itself. */
function contribution(owner: string, names: string[]): EntryFilterExtension {
    return {
        fields: Object.fromEntries(
            names.map((name) => [name, { type: ScalarFieldType.Number }])
        ),
        resolve: async () => owner as unknown as SQL
    };
}

/** A rule naming one field. */
function rule(field: string): ParsedRule {
    return { kind: 'rule', path: [field], op: 'eq', value: 1 } as ParsedRule;
}

describe('EntryFilterProviderRegistry.compose', () => {
    it('returns undefined when nobody contributes', () => {
        // So a type with no virtual fields builds exactly the surface it did
        // before the registry existed, and the caller keeps its no-extension
        // branch.
        expect(
            new EntryFilterProviderRegistry().compose(TYPE, undefined)
        ).toBeUndefined();
    });

    it('passes a lone contribution through untouched', () => {
        const only = contribution('i18n', ['hasLocale']);
        expect(new EntryFilterProviderRegistry().compose(TYPE, only)).toBe(
            only
        );
    });

    it('merges the bound extension with the registered providers', () => {
        const registry = new EntryFilterProviderRegistry();
        registry.register({
            filterFor: () => contribution('segments', ['audienceAllowed'])
        });

        const composed = registry.compose(
            TYPE,
            contribution('i18n', ['hasLocale'])
        );

        expect(Object.keys(composed?.fields ?? {}).sort()).toEqual([
            'audienceAllowed',
            'hasLocale'
        ]);
    });

    it('routes a rule to whoever declared its field', async () => {
        // The whole point of merging: one `resolve` for the query path, several
        // owners behind it.
        const registry = new EntryFilterProviderRegistry();
        registry.register({
            filterFor: () => contribution('segments', ['audienceAllowed'])
        });
        const composed = registry.compose(
            TYPE,
            contribution('i18n', ['hasLocale'])
        );

        await expect(
            composed?.resolve(rule('hasLocale'), CONTEXT)
        ).resolves.toBe('i18n');
        await expect(
            composed?.resolve(rule('audienceAllowed'), CONTEXT)
        ).resolves.toBe('segments');
    });

    it('keeps the first declarer of a duplicated field name [content:I-26]', async () => {
        // Letting the last writer win would make what a saved filter *means*
        // depend on plugin registration order.
        const registry = new EntryFilterProviderRegistry();
        registry.register({
            filterFor: () => contribution('late', ['shared'])
        });
        const composed = registry.compose(
            TYPE,
            contribution('early', ['shared'])
        );

        await expect(composed?.resolve(rule('shared'), CONTEXT)).resolves.toBe(
            'early'
        );
    });

    it('skips a provider that contributes nothing for this type', () => {
        // What a plugin installed but unconfigured must return, so a bare
        // install pays nothing.
        const registry = new EntryFilterProviderRegistry();
        registry.register({ filterFor: () => undefined });

        expect(registry.compose(TYPE, undefined)).toBeUndefined();
    });

    it('registers an instance once', () => {
        const registry = new EntryFilterProviderRegistry();
        const provider = {
            filterFor: () => contribution('segments', ['audienceAllowed'])
        };
        registry.register(provider);
        registry.register(provider);

        // Registered twice, the second pass would collide with itself and warn.
        expect(
            Object.keys(registry.compose(TYPE, undefined)?.fields ?? {})
        ).toEqual(['audienceAllowed']);
    });
});
