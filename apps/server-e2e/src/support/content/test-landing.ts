import { field, single } from '@ortha/content-server/define';

/**
 * `test_landing` — the e2e-owned single (equivalent of the app's `landing`),
 * routed at `/`. Mirrors {@link testArticle}'s scalar field coverage.
 *
 * Intentionally **not** `publishable`: a single is always live, with no
 * draft/published workflow — so it exercises the no-`status` path (the
 * list/write specs assert `status` is absent and a status filter / publish call
 * 400s). Because it is non-publishable, its required localized `text` stays NOT
 * NULL, so an incomplete create validates and 422s.
 *
 * It **is** `i18n`: one row per locale (the single resolves by the active
 * locale). Owned by the server-e2e harness — NOT imported from `apps/server`.
 */
export const testLanding = single('test_landing', {
    label: 'Test landing',
    description: 'The e2e landing page — every field type, end to end.',
    path: '/',
    i18n: true,
    fields: {
        text: field.text({
            required: true,
            localized: true,
            minLength: 3,
            maxLength: 120,
            admin: {
                label: 'Text',
                description: 'The landing page headline (3–120 characters).'
            }
        }),
        richtext: field.richtext({
            localized: true,
            admin: {
                label: 'Richtext',
                description: 'Intro copy shown beneath the headline.'
            }
        }),
        number: field.number({
            integer: true,
            min: 0,
            admin: {
                label: 'Number',
                description: 'A non-negative whole number.'
            }
        }),
        money: field.money({
            min: 0,
            admin: {
                label: 'Money',
                description: 'An amount stored in minor units (cents).'
            }
        }),
        boolean: field.boolean({
            required: true,
            admin: {
                label: 'Boolean',
                description: 'Toggle this section on/off.'
            }
        }),
        date: field.date({
            admin: { label: 'Date', description: 'A calendar date, no time.' }
        }),
        datetime: field.datetime({
            admin: {
                label: 'Datetime',
                description: 'A specific point in time.'
            }
        }),
        select: field.select({
            options: ['light', 'dark', 'auto'] as const,
            admin: {
                label: 'Select',
                description: 'Pick the default color theme.'
            }
        }),
        multiselect: field.multiselect({
            options: ['hero', 'newsletter', 'banner', 'footer'] as const,
            admin: {
                label: 'Multiselect',
                description: 'Choose which sections to render.'
            }
        }),
        json: field.json({
            admin: {
                label: 'Json',
                description: 'Arbitrary structured data as raw JSON.'
            }
        })
    }
});
