import {
    collection,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { testArticle } from './test-article';

/**
 * `test_tag` — the e2e-owned equivalent of the app's `tag`. The far side of a
 * many-to-many with {@link testArticle}; the links live in the generated
 * `content_test_article_tags` join table (declared by the `many: true` relation
 * on `test_article`). `articles` below is that relation's **inverse** (a two-way
 * relation), so the link is editable from the tag side too.
 *
 * `paranoid` (soft delete) so the entries-write "keeps a link on soft delete but
 * drops it on purge" case holds. `slug`'s `widget: 'slug'` is what the
 * relation-ref slug-resolution case reads.
 *
 * Owned by the server-e2e harness — NOT imported from `apps/server`.
 */
export const testTag = collection('test_tag', {
    label: 'Test tags',
    description: 'Free-form labels shared across test articles.',
    publishable: true,
    paranoid: true,
    fields: {
        name: field.text({
            required: true,
            minLength: 1,
            maxLength: 60,
            admin: { label: 'Name', description: 'The tag label.' }
        }),
        slug: field.text({
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            admin: {
                label: 'Slug',
                widget: 'slug',
                description: 'URL-safe identifier (lowercase, hyphenated).'
            }
        }),
        // Inverse of test_article.tags — the both-sided view of the same link.
        // The thunk's return is annotated `AnyContentType` to break the
        // test_article⇄test_tag type-inference cycle; the registry resolves it
        // at runtime.
        articles: field.relationInverse({
            of: (): AnyContentType => testArticle,
            field: 'tags',
            admin: {
                label: 'Articles',
                description:
                    'Articles tagged with this tag (editable both ways).'
            }
        })
    }
});
