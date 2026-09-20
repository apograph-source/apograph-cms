/**
 * `author` — a plain, non-publishable, non-localized collection.
 *
 * Being non-publishable, its `required` fields become real `NOT NULL`
 * columns (there is no draft stage to relax them). It is the target of
 * `article.author` (a required many-to-one) and owns the **inverse**
 * `articles` back-reference — an inverse-of-a-single, i.e. a one-to-many
 * that stores nothing of its own.
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { article } from './article';

export const author = collection('author', {
    label: 'Authors',
    description: 'People who write articles.',
    fields: {
        // Required on a non-publishable type ⇒ NOT NULL in Postgres.
        name: field.text({
            required: true,
            minLength: 2,
            maxLength: 120,
            admin: { label: 'Full name', placeholder: 'Ada Lovelace' }
        }),
        // `pattern` validation + a custom admin widget hint.
        email: field.text({
            required: true,
            pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            admin: { widget: 'email', placeholder: 'ada@example.com' }
        }),
        // The `slug` widget marks this as the type's slug field (used in
        // relation refs as a `/handle`).
        handle: field.text({
            required: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: {
                widget: 'slug',
                description: 'URL handle, e.g. ada-lovelace'
            }
        }),
        // Long-form, block-based rich text.
        bio: field.richtext({
            maxLength: 4000,
            admin: { description: 'Short biography shown on the author page.' }
        }),
        // `color` widget over a plain text column.
        accentColor: field.text({
            admin: { widget: 'color', label: 'Accent colour' }
        }),
        website: field.text({
            admin: { placeholder: 'https://…' }
        }),
        // The INVERSE of `article.author`: a one-to-many back-reference that
        // owns no storage. `of` is annotated to break the file-import cycle
        // (author ↔ article).
        articles: field.relationInverse({
            of: (): AnyContentType => article,
            field: 'author',
            admin: { label: 'Articles by this author' }
        })
    }
});
