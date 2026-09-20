/**
 * `article` — the kitchen-sink collection.
 *
 * Flags: `publishable` + `paranoid` + `i18n` (all three envelope layers at
 * once). Being publishable, `required` fields stay **nullable** columns and
 * are enforced only at publish time (an incomplete draft still saves).
 *
 * Fields cover every builder; relations cover every cardinality:
 *   - many-to-one, required, ON DELETE RESTRICT ....... `author`
 *   - one-to-one (UNIQUE FK) .......................... `seo`
 *   - many-to-one, optional, ON DELETE SET NULL ....... `category`
 *   - many-to-many (join table), per-locale ........... `tags`
 *   - many-to-many to self (join table) ............... `related`
 *   - one-to-many inverse (no storage) ................ `comments`
 *
 * The cross-file relation thunks are annotated `: AnyContentType` to break the
 * import/type-inference cycles (article ↔ author / tag / comment; self-ref).
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { author } from './author';
import { category } from './category';
import { comment } from './comment';
import { seo_meta } from './seo_meta';
import { tag } from './tag';

export const article = collection('article', {
    label: 'Articles',
    description: 'Long-form posts — the reference content type.',
    publishable: true,
    paranoid: true,
    i18n: true,
    fields: {
        // ---- text family -------------------------------------------------
        title: field.text({
            required: true, // required-to-publish (nullable column)
            localized: true,
            minLength: 3,
            maxLength: 200
        }),
        slug: field.text({
            required: true,
            localized: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: { widget: 'slug' }
        }),
        excerpt: field.text({
            localized: true,
            maxLength: 320,
            admin: { widget: 'textarea', description: 'Card / meta summary.' }
        }),
        body: field.richtext({
            required: true,
            localized: true,
            admin: { description: 'The article body.' }
        }),

        // ---- numeric -----------------------------------------------------
        readingMinutes: field.number({
            integer: true,
            min: 0,
            admin: { label: 'Reading time (min)' }
        }),
        rating: field.number({ min: 0, max: 5 }),
        // Money is stored as integer minor units (cents).
        price: field.money({
            min: 0,
            admin: { description: 'Paywall price in cents (0 = free).' }
        }),

        // ---- boolean -----------------------------------------------------
        featured: field.boolean({ admin: { label: 'Feature on home page' } }),

        // ---- temporal ----------------------------------------------------
        editorialDate: field.date({
            admin: { label: 'Editorial date (no time)' }
        }),
        embargoUntil: field.datetime({
            admin: { description: 'Do not surface before this instant.' }
        }),

        // ---- enumerations ------------------------------------------------
        layout: field.select({
            options: ['standard', 'wide', 'full_bleed'],
            admin: { label: 'Layout' }
        }),
        audiences: field.multiselect({
            options: ['general', 'developers', 'designers', 'executives']
        }),

        // ---- escape hatch ------------------------------------------------
        metadata: field.json({
            admin: { description: 'Freeform structured metadata.' }
        }),

        // ---- media (Media Library assets) --------------------------------
        // Single image, shared across locales. Restricted to image assets.
        coverImage: field.media({
            accept: { kinds: ['image'] },
            admin: {
                label: 'Cover image',
                description: 'Shown on cards + hero.'
            }
        }),
        // Single image, per-locale (a localized hero for each translation).
        localizedHero: field.media({
            localized: true,
            accept: { kinds: ['image'] },
            admin: { label: 'Localized hero image' }
        }),
        // Ordered list of images (a gallery). Restricted by MIME wildcard.
        gallery: field.media({
            multiple: true,
            accept: { mimeTypes: ['image/*'] },
            admin: { label: 'Gallery', description: 'Ordered image gallery.' }
        }),

        // ---- relations ---------------------------------------------------
        // many-to-one, required → ON DELETE RESTRICT (a required single
        // relation cannot be SET NULL). Target is non-i18n ⇒ **shared**: one
        // author for the record, the same FK in every locale row.
        author: field.relation({
            to: (): AnyContentType => author,
            required: true,
            onDelete: 'restrict'
        }),
        // one-to-one. On a localized type the UNIQUE is per **locale**
        // (`(seo_id, locale)`), so the record's language rows may all point at
        // this one SEO record while no other article can claim it.
        seo: field.relation({
            to: (): AnyContentType => seo_meta,
            unique: true,
            onDelete: 'set null',
            admin: { label: 'SEO metadata' }
        }),
        // many-to-one, optional → ON DELETE SET NULL. Non-i18n target ⇒ shared.
        category: field.relation({
            to: (): AnyContentType => category,
            onDelete: 'set null'
        }),
        // many-to-many (join table). Target is i18n ⇒ **mirrored**: tagging the
        // English article tags the German one with the German tag.
        tags: field.relation({
            to: (): AnyContentType => tag,
            many: true
        }),
        // many-to-many to SELF (a "related articles" graph). Self ⇒ i18n target
        // ⇒ mirrored: each locale links its own language's related articles.
        related: field.relation({
            to: (): AnyContentType => article,
            many: true,
            admin: { label: 'Related articles' }
        }),
        // inverse of `comment.article` (one-to-many, no storage).
        comments: field.relationInverse({
            of: (): AnyContentType => comment,
            field: 'article'
        })
    }
});
