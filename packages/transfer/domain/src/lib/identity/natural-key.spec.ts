import {
    IDENTITY_SOURCE,
    naturalKeyOf,
    resolveIdentityFields
} from './natural-key';
import type { TransferTypeSchema } from '../schema/type-schema';

function schema(
    overrides: Partial<TransferTypeSchema> = {}
): TransferTypeSchema {
    return {
        name: 'post',
        publishable: true,
        paranoid: true,
        i18n: false,
        fields: [],
        ...overrides
    };
}

describe('resolveIdentityFields', () => {
    it('prefers the configured list over anything derivable', () => {
        const resolved = resolveIdentityFields(
            schema({
                fields: [
                    { name: 'slug', type: 'text', required: true },
                    { name: 'title', type: 'text', required: true }
                ]
            }),
            ['title']
        );

        expect(resolved).toEqual({
            fields: ['title'],
            source: IDENTITY_SOURCE.Configured
        });
    });

    it('picks a slug-like field ahead of the first required text', () => {
        const resolved = resolveIdentityFields(
            schema({
                fields: [
                    { name: 'title', type: 'text', required: true },
                    { name: 'slug', type: 'text', required: false }
                ]
            })
        );

        expect(resolved.fields).toEqual(['slug']);
        expect(resolved.source).toBe(IDENTITY_SOURCE.UniqueField);
    });

    it('falls back to the first required text field', () => {
        const resolved = resolveIdentityFields(
            schema({
                fields: [
                    { name: 'summary', type: 'text', required: false },
                    { name: 'title', type: 'text', required: true }
                ]
            })
        );

        expect(resolved.fields).toEqual(['title']);
        expect(resolved.source).toBe(IDENTITY_SOURCE.RequiredText);
    });

    it('keys a localized field — a transfer record is one row, not one per language', () => {
        // The alternative leaves a fully-localized type (every text field
        // varying per language, which is the normal shape) with no key at all,
        // so every import of it duplicates every row. What separates `en`/hello
        // from `de`/hello is the locale in the fingerprint, not the exclusion.
        const resolved = resolveIdentityFields(
            schema({
                i18n: true,
                fields: [
                    {
                        name: 'slug',
                        type: 'text',
                        required: true,
                        localized: true
                    }
                ]
            })
        );

        expect(resolved.fields).toEqual(['slug']);
        expect(resolved.source).toBe(IDENTITY_SOURCE.UniqueField);
    });

    it('prefers a shared slug over a localized title on an i18n type', () => {
        const resolved = resolveIdentityFields(
            schema({
                i18n: true,
                fields: [
                    {
                        name: 'title',
                        type: 'text',
                        required: true,
                        localized: true
                    },
                    { name: 'slug', type: 'text', required: true }
                ]
            })
        );

        expect(resolved.fields).toEqual(['slug']);
    });

    it('reports row-id when the type has nothing keyable', () => {
        const resolved = resolveIdentityFields(
            schema({
                fields: [
                    { name: 'body', type: 'richtext', required: true },
                    { name: 'cover', type: 'media', required: false }
                ]
            })
        );

        expect(resolved).toEqual({
            fields: [],
            source: IDENTITY_SOURCE.RowId
        });
    });
});

describe('naturalKeyOf', () => {
    it('stringifies scalars and stamps dates as ISO', () => {
        const key = naturalKeyOf(['slug', 'issue', 'published'], {
            slug: 'hello',
            issue: 12,
            published: new Date('2026-01-02T03:04:05.000Z')
        });

        expect(key).toEqual({
            slug: 'hello',
            issue: '12',
            published: '2026-01-02T03:04:05.000Z'
        });
    });

    it('omits a field with no usable value rather than writing an empty string', () => {
        // The distinction matters downstream: "no key" falls back to create,
        // while a key of "" would match every other keyless record.
        expect(
            naturalKeyOf(['slug', 'code'], { slug: '', code: null })
        ).toEqual({});
    });

    it('omits a value it cannot render deterministically', () => {
        expect(naturalKeyOf(['blob'], { blob: { nested: true } })).toEqual({});
    });
});
