import { collection, field } from '@orthacms/content-server/define';
import { testAuthor } from './test-author';
import { testTag } from './test-tag';
import { testSeo } from './test-seo';

/**
 * `test_article` — the e2e-owned reference collection (equivalent of the app's
 * `article`), owned by the server-e2e harness and NOT imported from
 * `apps/server`. It exercises **every** scalar field type in the `field.*`
 * vocabulary, then every relation cardinality:
 *
 * - **many-to-one** — `author` (a single FK; deleting an author nulls it).
 * - **one-to-many** — the inverse of `author`, and `test_comment.article`.
 * - **one-to-one** — `seo` (a single FK with a `UNIQUE` constraint).
 * - **many-to-many** — `tags` (a generated `content_test_article_tags` join).
 *
 * Also the reference **i18n** type: each locale is a full row sharing a
 * `locale_group_id`. Content fields (`text`, `richtext`) are `localized`;
 * everything else (incl. the required `select`) is shared — synced across the
 * translation group by the i18n plugin on every update.
 *
 * `publishable` + `paranoid` drive the draft/publish lifecycle and
 * soft-delete/restore/purge specs. The `select` options and `text`
 * (minLength 3) mirror the payloads the content/i18n/workspace specs send.
 */
export const testArticle = collection('test_article', {
    label: 'Articles',
    description: 'The e2e reference collection — every field type, end to end.',
    publishable: true,
    paranoid: true,
    i18n: true,
    fields: {
        text: field.text({
            required: true,
            localized: true,
            minLength: 3,
            maxLength: 200,
            admin: {
                label: 'Text',
                description: 'A short single-line string (3–200 characters).'
            }
        }),
        richtext: field.richtext({
            localized: true,
            admin: {
                label: 'Richtext',
                widget: 'textarea',
                description: 'Long-form body copy for the article.'
            }
        }),
        number: field.number({
            integer: true,
            min: 1,
            max: 120,
            admin: {
                label: 'Number',
                description: 'A whole number between 1 and 120.'
            }
        }),
        money: field.money({
            min: 0,
            admin: {
                label: 'Money',
                description: 'An amount stored in minor units (cents).'
            }
        }),
        boolean: field.boolean({
            admin: {
                label: 'Boolean',
                description: 'Toggle this article on/off.'
            }
        }),
        date: field.date({
            admin: { label: 'Date', description: 'A calendar date, no time.' }
        }),
        datetime: field.datetime({
            admin: {
                label: 'Datetime',
                description: 'A specific point in time.'
            }
        }),
        select: field.select({
            options: ['article', 'tutorial', 'changelog'] as const,
            required: true,
            admin: {
                label: 'Select',
                description: 'Pick exactly one content category.'
            }
        }),
        multiselect: field.multiselect({
            options: ['draft', 'featured', 'archived', 'pinned'] as const,
            admin: {
                label: 'Multiselect',
                description: 'Choose any number of labels for this article.'
            }
        }),
        json: field.json({
            admin: {
                label: 'Json',
                description: 'Arbitrary structured data as raw JSON.'
            }
        }),
        // media: single image, shared across locales, restricted to images.
        image: field.media({
            accept: { kinds: ['image'] },
            admin: { label: 'Cover image' }
        }),
        // media: single image, per-locale (a localized hero per translation).
        heroImage: field.media({
            localized: true,
            accept: { kinds: ['image'] },
            admin: { label: 'Localized hero' }
        }),
        // media: ordered list of any asset kind (attachments).
        attachments: field.media({
            multiple: true,
            admin: { label: 'Attachments' }
        }),
        // many-to-one: many articles → one author. Single FK column
        // `author_id`; deleting an author nulls it (the article survives).
        author: field.relation({
            to: () => testAuthor,
            onDelete: 'set null',
            admin: {
                label: 'Author',
                description: 'The author who wrote this article (many-to-one).'
            }
        }),
        // one-to-one: an article owns at most one SEO record. `unique: true`
        // adds a UNIQUE constraint on the `seo_id` FK; deleting the record nulls
        // it (default onDelete for an optional relation).
        //
        // On a localized type that UNIQUE is scoped to the locale
        // (`(seo_id, locale)`), so the article's language rows share one SEO
        // record while no other article can claim it.
        seo: field.relation({
            to: () => testSeo,
            unique: true,
            admin: {
                label: 'SEO metadata',
                description:
                    'Search-engine metadata for this article (one-to-one).'
            }
        }),
        // The **opt-out**: a tag pinned for this language only. Same
        // non-localized target as `tags`, so the only thing separating them is
        // `syncAcrossLocales` — which is exactly what this fixture is for.
        pinnedTag: field.relation({
            to: () => testTag,
            syncAcrossLocales: false,
            admin: {
                label: 'Pinned tag',
                description: 'Featured for this locale only (not synced).'
            }
        }),
        // many-to-many: an article links to any number of tags via the
        // generated `content_test_article_tags` join table. `test_tag` is NOT
        // localized, so this relation is **shared** — one tag row is the tag
        // for every language, and tagging any locale tags the whole record.
        tags: field.relation({
            to: () => testTag,
            many: true,
            admin: {
                label: 'Tags',
                description: 'Labels applied to this article (many-to-many).'
            }
        }),
        // many-to-many to a **localized** target — the mirrored case, and the
        // one `tags` cannot cover: `test_author` has a row per locale, so each
        // sibling article links that contributor's own translation. Adding a
        // contributor to the English article adds the German contributor row to
        // the German article.
        contributors: field.relation({
            to: () => testAuthor,
            many: true,
            admin: {
                label: 'Contributors',
                description:
                    'Co-authors of this article (many-to-many, localized target).'
            }
        })
    }
});
