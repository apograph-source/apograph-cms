/**
 * `master_collection` — the exhaustive reference collection.
 *
 * One type that exercises **every** DSL capability at once:
 *   - all three envelope flags: `publishable` + `paranoid` + `i18n`
 *   - every field builder: text / richtext / number / money / boolean / date /
 *     datetime / select / multiselect / json / relation / relationInverse
 *   - every text validation (minLength / maxLength / pattern) and admin widget
 *     (textarea / slug / color / email + custom pass-through props)
 *   - localized vs shared fields; required vs optional
 *   - every relation cardinality and onDelete:
 *       many-to-one required (RESTRICT) ......... `owner`
 *       many-to-one optional (SET NULL, self) ... `parent`
 *       one-to-one (UNIQUE) ..................... `seo`
 *       many-to-many (join table, per-locale) ... `tags`
 *       many-to-many to self (join table) ....... `related`
 *       one-to-many inverse (self, no storage) .. `children`
 *
 * Self-referential and cross-file thunks are annotated `: AnyContentType`
 * to break the type-inference cycles.
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { author } from './author';
import { seo_meta } from './seo_meta';
import { tag } from './tag';

export const master_collection = collection('master_collection', {
    label: 'Master collection',
    description:
        'Every field type, flag, and relation cardinality in one type.',
    publishable: true,
    paranoid: true,
    i18n: true,
    fields: {
        // ---- text: required + all validations + localized -----------------
        plainText: field.text({
            required: true,
            localized: true,
            minLength: 1,
            maxLength: 255,
            admin: {
                label: 'Plain text',
                description: 'Required, localized, length-bounded.',
                placeholder: 'Type here…'
            }
        }),
        // text + regex pattern + email widget
        email: field.text({
            pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            admin: { widget: 'email' }
        }),
        // text + slug widget (marks the type's slug field)
        slug: field.text({
            required: true,
            localized: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: { widget: 'slug' }
        }),
        // text + color widget
        brandColor: field.text({ admin: { widget: 'color' } }),
        // text + textarea widget + custom pass-through admin prop
        summary: field.text({
            localized: true,
            maxLength: 500,
            admin: { widget: 'textarea', rows: 4 }
        }),

        // ---- richtext -----------------------------------------------------
        body: field.richtext({
            required: true,
            localized: true,
            maxLength: 50000
        }),

        // ---- number: float, integer, bounded ------------------------------
        score: field.number({ min: 0, max: 100 }),
        viewCount: field.number({ integer: true, min: 0 }),

        // ---- money (integer minor units) ----------------------------------
        price: field.money({ min: 0, max: 1_000_000 }),

        // ---- boolean (required ⇒ DEFAULT false) ---------------------------
        featured: field.boolean({ required: true }),

        // ---- temporal -----------------------------------------------------
        eventDate: field.date(),
        startsAt: field.datetime(),

        // ---- enumerations -------------------------------------------------
        status_choice: field.select({
            options: ['alpha', 'beta', 'ga'],
            admin: { label: 'Release channel' }
        }),
        topics: field.multiselect({
            options: ['news', 'tutorial', 'opinion', 'reference']
        }),

        // ---- json escape hatch --------------------------------------------
        metadata: field.json(),

        // ---- media: single/multiple, localized/shared, restricted ---------
        // localized single image (per-locale hero)
        heroImage: field.media({
            localized: true,
            accept: { kinds: ['image'] },
            admin: { label: 'Hero image' }
        }),
        // shared multiple, any asset kind
        attachments: field.media({ multiple: true }),
        // shared single, restricted to PDF by exact MIME
        brochure: field.media({
            accept: { mimeTypes: ['application/pdf'] },
            admin: { label: 'Brochure (PDF)' }
        }),

        // ---- relations: every cardinality ---------------------------------
        // many-to-one, required, RESTRICT
        owner: field.relation({
            to: (): AnyContentType => author,
            required: true,
            onDelete: 'restrict'
        }),
        // one-to-one; the UNIQUE is per locale on a localized type.
        seo: field.relation({
            to: (): AnyContentType => seo_meta,
            unique: true,
            onDelete: 'set null'
        }),
        // many-to-many, per-locale (tag is i18n)
        tags: field.relation({
            to: (): AnyContentType => tag,
            many: true
        }),
        // self many-to-one, optional, SET NULL
        parent: field.relation({
            to: (): AnyContentType => master_collection,
            onDelete: 'set null'
        }),
        // self many-to-many
        related: field.relation({
            to: (): AnyContentType => master_collection,
            many: true
        }),
        // self one-to-many inverse (over `parent`, no storage)
        children: field.relationInverse({
            of: (): AnyContentType => master_collection,
            field: 'parent'
        })
    }
});
