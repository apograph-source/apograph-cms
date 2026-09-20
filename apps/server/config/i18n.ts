/** The content locales, and what to do about rows left in a removed one. */
import type { I18nPluginConfig } from '@orthacms/i18n-server';

/** The content locales, and what to do about rows left in a removed one. */
export function i18nConfig(): I18nPluginConfig {
    return {
        // Content locales — stable product configuration, so literals (like the
        // rest of the non-secret tuning here). The slugs are stored on entry
        // rows; the migration backfill assumes 'en' is the default.
        locales: [
            { slug: 'en', name: 'English', isDefault: true },
            { slug: 'de', name: 'Deutsch' },
            { slug: 'fr', name: 'Français' }
        ],
        // What to do at boot when entry rows exist in a locale no longer listed
        // above. Removing a locale does not remove its rows, and from that
        // moment they are invisible to every read path — intact and
        // unreachable, which is the worst shape for a silent failure. Failing
        // the boot puts the choice (migrate the rows, or restore the locale) in
        // front of whoever edited this array. `warn` for a deployment knowingly
        // mid-migration.
        orphanedLocales: 'fail'
    };
}
