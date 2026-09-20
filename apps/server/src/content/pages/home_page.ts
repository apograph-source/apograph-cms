/**
 * `home_page` — a **single** (routed, one entry) that is **localized** and
 * **publishable**. Demonstrates the single kind + `path`, i18n on a page, and
 * a single relation from a page into a collection (`featured → article`).
 */

import {
    single,
    field,
    type AnyContentType
} from '@orthacms/content-server/define';
import { article } from '../collections/article';

export const home_page = single('home_page', {
    label: 'Home page',
    description: 'The localized landing page.',
    path: '/',
    i18n: true,
    publishable: true,
    fields: {
        heroTitle: field.text({
            required: true,
            localized: true,
            maxLength: 120
        }),
        heroSubtitle: field.text({
            localized: true,
            admin: { widget: 'textarea' }
        }),
        ctaLabel: field.text({ localized: true, maxLength: 40 }),
        ctaHref: field.text({ admin: { placeholder: '/pricing' } }),
        showcaseTheme: field.select({
            options: ['light', 'dark', 'brand']
        }),
        // Single relation from a page → a collection entry.
        featured: field.relation({
            to: (): AnyContentType => article,
            onDelete: 'set null',
            admin: { label: 'Featured article' }
        })
    }
});
