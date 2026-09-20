/**
 * `tag` — a **localized** (`i18n`) collection that is also the target of a
 * many-to-many (`article.tags`).
 *
 * Because the type is `i18n` *and* is reached by a single/inverse relation
 * from another i18n type, `article.tags` is treated as a **per-locale
 * relation** — the picker offers only same-locale tags. `name` varies per
 * locale; `slug` is marked shared here to show a non-localized field on an
 * i18n type. It owns the **inverse** `articles` (a many-to-many back-reference).
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { article } from './article';

export const tag = collection('tag', {
    label: 'Tags',
    description: 'Localized taxonomy terms.',
    i18n: true,
    fields: {
        // Localized: each locale row carries its own translated name.
        name: field.text({
            required: true,
            localized: true,
            maxLength: 60
        }),
        // Unmarked ⇒ shared across the translation group (synced to siblings).
        slug: field.text({
            required: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: { widget: 'slug' }
        }),
        // Inverse of the owning many-to-many `article.tags`: reuses the same
        // join table (source/target swapped). Defaults to many.
        articles: field.relationInverse({
            of: (): AnyContentType => article,
            field: 'tags'
        })
    }
});
