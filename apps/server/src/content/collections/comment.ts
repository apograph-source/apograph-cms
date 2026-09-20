/**
 * `comment` — a **paranoid** collection whose `article` relation is a
 * **required single relation with `ON DELETE CASCADE`** (the required
 * many-to-one path: the FK is enforced, and deleting the article removes its
 * comments). Its inverse lives on `article.comments`.
 */

import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { article } from './article';

export const comment = collection('comment', {
    label: 'Comments',
    description: 'Reader comments attached to an article.',
    paranoid: true,
    fields: {
        authorName: field.text({ required: true, maxLength: 120 }),
        body: field.text({
            required: true,
            maxLength: 2000,
            admin: { widget: 'textarea' }
        }),
        rating: field.number({ min: 1, max: 5 }),
        approved: field.boolean({
            required: true,
            admin: { label: 'Approved for display' }
        }),
        // Required single relation → cascade (default for a required relation).
        // Cross-file thunk annotated to break the article ↔ comment cycle.
        article: field.relation({
            to: (): AnyContentType => article,
            required: true,
            onDelete: 'cascade'
        })
    }
});
