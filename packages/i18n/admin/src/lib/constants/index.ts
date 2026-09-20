/**
 * Shared string constants of the i18n admin plugin — URL params, API paths,
 * permissions, and slot item ids, so none live as magic literals.
 */

/** URL query param holding the active content locale. */
export const LOCALE_PARAM = 'locale';

/**
 * URL query param carrying the translation group a created row joins (a
 * sibling). Matches the server `SaveEntryDto.localeGroupId` body key, so the
 * entry-params slot forwards it straight into the create body.
 */
export const LOCALE_GROUP_PARAM = 'localeGroupId';

/** URL/list param widening a list to default-locale fallback. */
export const LOCALE_FALLBACK_PARAM = 'localeFallback';

/** The `localeFallback` value the server understands. */
export const LOCALE_FALLBACK_DEFAULT = 'default';

/** API path of the configured-locales read. */
export const LOCALES_PATH = '/i18n/locales';

/** API path prefix of the locale-domain content endpoints. */
export const I18N_CONTENT_PATH = '/i18n/content';

/**
 * API path of the localization coverage read.
 *
 * Under `insights/`, not this plugin's own `i18n/` prefix — the Insights page's
 * endpoints are grouped by what they are, beside content's and media's.
 */
export const I18N_COVERAGE_PATH = '/insights/i18n/coverage';

/** Permission required to read entries — and so to count translations of them. */
export const CONTENT_READ = 'content:read';

/** Permission required to create an entry (and thus a translation). */
export const CONTENT_CREATE = 'content:create';

/** Permission required to publish or unpublish an entry (and so every locale). */
export const CONTENT_PUBLISH = 'content:publish';

/** Slot item ids (also React keys) for this plugin's contributions. */
export const SLOT_ITEM_ID = {
    Switcher: 'i18n.localeSwitcher',
    Column: 'i18n.localesColumn',
    DetailsRow: 'i18n.localeDetailsRow',
    TitleChip: 'i18n.localeTitleChip',
    FilterFields: 'i18n.filterFields',
    SwitchOverlay: 'i18n.localeSwitchOverlay',
    EntryParams: 'i18n.entryParams',
    PublishAll: 'i18n.publishAllLocales',
    UnpublishAll: 'i18n.unpublishAllLocales',
    CoverageWidget: 'insights.i18n.coverage'
} as const;

/** Virtual filter field ids — must match the server extension's names. */
export const LOCALE_FILTER_FIELD = {
    HasLocale: 'hasLocale',
    MissingLocale: 'missingLocale',
    LocaleCount: 'localeCount'
} as const;
