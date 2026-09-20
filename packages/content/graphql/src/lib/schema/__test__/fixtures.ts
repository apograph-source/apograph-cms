import { collection, field, single } from '@orthacms/content-server/define';
import { ContentTypeRegistry } from '@orthacms/content-server';
import type { AnyContentType } from '@orthacms/content-server';

/**
 * A small content model for the schema tests — real `collection()` / `single()`
 * types rather than hand-built stubs, so the tests exercise the same specs the
 * server would hand the builder.
 *
 * Deliberately covers the shapes that make the mapping non-obvious: every
 * publish/locale flag combination, a `select` with both representable and
 * unrepresentable options, both relation cardinalities plus an inverse, and a
 * media field.
 */

/** A plain, non-publishable, non-localized type — the simple baseline. */
export const tag = collection('tag', {
    label: 'Tags',
    fields: {
        name: field.text({ required: true }),
        weight: field.number({ integer: true })
    }
});

/** The interesting one: publishable, localized, and richly typed. */
export const article: AnyContentType = collection('article', {
    label: 'Articles',
    description: 'Long-form posts.',
    publishable: true,
    paranoid: true,
    i18n: true,
    fields: {
        title: field.text({ required: true, localized: true }),
        body: field.richtext({ localized: true }),
        readingMinutes: field.number({ integer: true }),
        price: field.money(),
        featured: field.boolean(),
        publishedOn: field.date(),
        reviewedAt: field.datetime(),
        stage: field.select({ options: ['idea', 'writing', 'ready'] }),
        // Options that cannot all be GraphQL enum names, so the field must fall
        // back to `String` rather than rename a value on the wire.
        channel: field.select({ options: ['web', '2nd-run'] }),
        topics: field.multiselect({ options: ['tech', 'design'] }),
        meta: field.json(),
        cover: field.media(),
        gallery: field.media({ multiple: true }),
        tags: field.relation({ to: () => tag, many: true }),
        // A single relation into a type a workspace may not be granted, so the
        // pruning tests have something to prune.
        secret: field.relation({ to: () => vault })
    }
});

/** The type used to prove ungranted relation targets are pruned. */
export const vault = collection('vault', {
    label: 'Vault',
    fields: { code: field.text() }
});

/** A `single` — one record, so it gets no list field. */
export const landing = single('landing', {
    label: 'Landing page',
    path: '/',
    publishable: true,
    fields: { headline: field.text() }
});

/** Every fixture type, in registry order. */
export const fixtureTypes: AnyContentType[] = [
    article,
    tag,
    vault,
    landing as AnyContentType
];

/** A registry over {@link fixtureTypes}. */
export function fixtureRegistry(): ContentTypeRegistry {
    return new ContentTypeRegistry(fixtureTypes);
}

/** The grant set covering everything but `vault`. */
export const GRANTED_WITHOUT_VAULT: ReadonlySet<string> = new Set([
    'article',
    'tag',
    'landing'
]);

/** The grant set covering every fixture type. */
export const GRANTED_ALL: ReadonlySet<string> = new Set([
    'article',
    'tag',
    'vault',
    'landing'
]);
