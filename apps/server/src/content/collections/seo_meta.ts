/**
 * `seo_meta` — the **one-to-one target**, reached from `article.seo`
 * (`field.relation({ unique: true })`). A plain non-publishable type so its
 * required fields are `NOT NULL`. Shows the `textarea` widget, a `boolean`,
 * and a `json` escape-hatch column.
 */

import { collection, field } from '@orthacms/content-server/define';

export const seo_meta = collection('seo_meta', {
    label: 'SEO metadata',
    description:
        'Per-entry search/social metadata (one-to-one with an article).',
    fields: {
        metaTitle: field.text({
            required: true,
            maxLength: 70,
            admin: { description: 'Overrides the <title> tag.' }
        }),
        metaDescription: field.text({
            maxLength: 160,
            admin: { widget: 'textarea' }
        }),
        canonicalUrl: field.text({ admin: { placeholder: 'https://…' } }),
        noindex: field.boolean({
            required: true,
            admin: { label: 'Exclude from search engines' }
        }),
        // Arbitrary structured payload — Open Graph / Twitter card overrides.
        openGraph: field.json({
            admin: { description: 'Raw og:* / twitter:* overrides as JSON.' }
        })
    }
});
