/**
 * `category` — a **paranoid** (soft-delete) collection with a
 * **self-referential** hierarchy.
 *
 * `parent` is a single relation pointing back at the same type
 * (`onDelete: 'set null'`, so deleting a parent orphans rather than cascades)
 * — a self many-to-one. `children` is its **inverse** (a one-to-many over the
 * same FK). Self-referencing thunks are annotated `: AnyContentType` to break
 * the type-inference cycle.
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';

export const category = collection('category', {
    label: 'Categories',
    description: 'A soft-deletable, self-nesting taxonomy.',
    paranoid: true,
    fields: {
        name: field.text({ required: true, maxLength: 80 }),
        slug: field.text({
            required: true,
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: { widget: 'slug' }
        }),
        description: field.text({ admin: { widget: 'textarea' } }),
        // Self many-to-one: optional parent, nulled on the parent's delete.
        parent: field.relation({
            to: (): AnyContentType => category,
            onDelete: 'set null',
            admin: { label: 'Parent category' }
        }),
        // Inverse one-to-many over the same `parent` FK.
        children: field.relationInverse({
            of: (): AnyContentType => category,
            field: 'parent',
            admin: { label: 'Sub-categories' }
        })
    }
});
