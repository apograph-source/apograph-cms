/**
 * `site_settings` — a **non-i18n single**. One global row (no publish state,
 * no localization). Shows `select`, `multiselect`, `json`, `boolean`, and the
 * `color` widget on a routed single.
 */

import { single, field } from '@orthacms/content-server/define';

export const site_settings = single('site_settings', {
    label: 'Site settings',
    description: 'Global, non-localized configuration.',
    path: '/settings',
    fields: {
        siteName: field.text({ required: true, maxLength: 80 }),
        tagline: field.text({ admin: { widget: 'textarea' } }),
        brandColor: field.text({ admin: { widget: 'color' } }),
        defaultCurrency: field.select({
            options: ['USD', 'EUR', 'GBP', 'JPY']
        }),
        enabledFeatures: field.multiselect({
            options: ['comments', 'search', 'newsletter', 'paywall']
        }),
        maintenanceMode: field.boolean({
            required: true,
            admin: { label: 'Maintenance mode' }
        }),
        socialLinks: field.json({
            admin: { description: 'Map of network → URL as JSON.' }
        })
    }
});
