/** Public API of @orthacms/i18n-admin. */

export { I18nPlugin } from './lib/utils/i18nPlugin';
export type { I18nAdminPlugin } from './lib/utils/i18nPlugin';

export { useLocales } from './lib/api/useLocales';
export { useLocalizationCoverage } from './lib/api/useLocalizationCoverage';
export type {
    ContentTypeCoverage,
    EntryLocaleItem,
    EntryLocalesResult,
    I18nCoverageResult,
    Locale,
    LocaleCoverage,
    LocaleSummariesResult,
    LocaleSummaryItem,
    LocalesResult
} from './lib/types/locale';
