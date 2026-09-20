/**
 * `master_single` — the exhaustive reference **single** (routed page).
 *
 * The single-kind counterpart to `master_collection`: same flags
 * (`publishable` + `paranoid` + `i18n`) and the full field/relation vocabulary,
 * plus the single-only `path`. Relations here are owning single + many
 * (an inverse would need another type to point back at this page).
 */

import {
    single,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { author } from '../collections/author';
import { seo_meta } from '../collections/seo_meta';
import { tag } from '../collections/tag';

export const master_single = single('master_single', {
    label: 'Master single',
    description: 'Every field type and flag, as a routed single page.',
    path: '/master',
    publishable: true,
    paranoid: true,
    i18n: true,
    fields: {
        // text family
        headline: field.text({
            required: true,
            localized: true,
            minLength: 1,
            maxLength: 200
        }),
        slug: field.text({
            required: true,
            localized: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: { widget: 'slug' }
        }),
        accentColor: field.text({ admin: { widget: 'color' } }),
        intro: field.text({ localized: true, admin: { widget: 'textarea' } }),
        contactEmail: field.text({
            pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            admin: { widget: 'email' }
        }),
        // richtext
        body: field.richtext({ required: true, localized: true }),
        // numeric / money
        weight: field.number({ min: 0, max: 10 }),
        hitCount: field.number({ integer: true, min: 0 }),
        price: field.money({ min: 0 }),
        // boolean
        published_flag: field.boolean({ required: true }),
        // temporal
        goLiveDate: field.date(),
        goLiveAt: field.datetime(),
        // enumerations
        variant: field.select({ options: ['a', 'b', 'c'] }),
        flags: field.multiselect({ options: ['hero', 'sticky', 'promoted'] }),
        // json
        config: field.json(),
        // relations
        curator: field.relation({
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
        tags: field.relation({
            to: (): AnyContentType => tag,
            many: true
        })
    }
});
