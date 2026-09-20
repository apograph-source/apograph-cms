/** The content locales, and what to do about rows left in a removed one. */
import type { I18nPluginConfig } from '@orthacms/i18n-server';

/** The content locales, and what to do about rows left in a removed one. */
export function i18nConfig(): I18nPluginConfig {
    return {
        // Content locales. Stable product configuration, hence literals. The
        // slugs are stored on entry rows, so removing one hides its rows rather
        // than deleting them — which is what `orphanedLocales` is about below.
        locales: [{ slug: 'en', name: 'English', isDefault: true }],
        // Rows in a locale no longer listed above are intact and unreachable,
        // the worst shape for a silent failure. Fail the boot and put the
        // choice in front of whoever edited the array.
        orphanedLocales: 'fail'
    };
}
