import { collection, field } from '@ortha/content-server/define';

/**
 * `test_seo` — the e2e-owned equivalent of the app's `seo_meta`. The far side of
 * a one-to-one with {@link testArticle}: an article owns at most one SEO record,
 * enforced by the `unique: true` single relation on `test_article.seo` (a
 * `UNIQUE` constraint on its `seo_id` FK).
 *
 * Deliberately **not** `i18n` — the i18n spec uses it as the non-localized type
 * that ignores `?locale=` and 400s the per-entry locale endpoints.
 *
 * Owned by the server-e2e harness — NOT imported from `apps/server`.
 */
export const testSeo = collection('test_seo', {
    label: 'Test SEO metadata',
    description:
        'Search-engine metadata attached one-to-one to a test article.',
    fields: {
        metaTitle: field.text({
            maxLength: 70,
            admin: {
                label: 'Meta title',
                description: 'Title tag (≤ 70 chars).'
            }
        }),
        metaDescription: field.text({
            maxLength: 160,
            admin: {
                label: 'Meta description',
                widget: 'textarea',
                description: 'Description meta tag (≤ 160 chars).'
            }
        }),
        canonicalUrl: field.text({
            admin: {
                label: 'Canonical URL',
                description: 'The canonical URL for this content.'
            }
        })
    }
});
