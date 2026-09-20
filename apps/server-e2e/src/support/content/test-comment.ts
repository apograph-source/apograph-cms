import { collection, field } from '@orthacms/content-server/define';
import { testArticle } from './test-article';
import { testSeo } from './test-seo';

/**
 * `test_comment` — the e2e-owned equivalent of the app's `comment`. The "many"
 * side of a one-to-many with {@link testArticle} (one article has many
 * comments). The relation is a **required** single relation on this collection,
 * producing an `article_id` FK column — exactly how a one-to-many is stored (the
 * "one" side owns no column). `onDelete` defaults to `'cascade'` for a required
 * relation, so deleting an article removes its comments.
 *
 * It also carries the model's only **`onDelete: 'restrict'`** relation
 * (`seoNote`): an optional single relation that explicitly refuses the delete of
 * a row still pointed at, so a spec can prove that refusal surfaces as a `409`
 * rather than a raw foreign-key `500`. `restrict` is otherwise unreachable
 * here — it is the default only for a *required* relation, and every required
 * relation in this model wants cascade.
 *
 * Owned by the server-e2e harness.
 */
export const testComment = collection('test_comment', {
    label: 'Test comments',
    description: 'Reader comments belonging to a single test article.',
    fields: {
        author: field.text({
            required: true,
            minLength: 1,
            maxLength: 120,
            admin: { label: 'Author', description: 'Name of the commenter.' }
        }),
        body: field.richtext({
            required: true,
            admin: {
                label: 'Body',
                widget: 'textarea',
                description: 'The comment text.'
            }
        }),
        article: field.relation({
            to: () => testArticle,
            required: true,
            admin: {
                label: 'Article',
                description: 'The article this comment belongs to.'
            }
        }),
        // Optional single relation with an EXPLICIT `restrict`: the FK is
        // nullable, so the delete is not refused for want of somewhere to put
        // a null — it is refused because the model says the reference must be
        // detached first. `test_seo` is the target because it is the only
        // **non-paranoid** collection here, and only a hard `DELETE` can reach
        // the constraint at all: a soft delete just stamps `deleted_at` and the
        // FK never notices.
        seoNote: field.relation({
            to: () => testSeo,
            onDelete: 'restrict',
            admin: {
                label: 'SEO note',
                description: 'An SEO record this comment annotates.'
            }
        })
    }
});
