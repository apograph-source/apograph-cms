/** Public API of @orthacms/i18n-server. */

export { I18nServerPlugin } from './lib/utils/i18n-plugin';
export type { I18nServerPluginType } from './lib/utils/i18n-plugin';
export type {
    I18nPluginConfig,
    LocaleDef,
    LocaleDir,
    OrphanedLocalePolicy
} from './lib/types/locale';
export { LOCALE_DIR, inferLocaleDir } from './lib/i18n.constants';
export { OrphanedLocaleChecker } from './lib/locales/services/orphaned-locale.checker';
export type { OrphanedLocaleReport } from './lib/locales/services/orphaned-locale.checker';

export { I18nModule } from './lib/i18n.module';
export { LocaleRegistryService } from './lib/locales/services/locale-registry.service';
export type { LocalesView } from './lib/locales/controllers/list-locales.controller';
export type {
    EntryLocaleItem,
    EntryLocalesView,
    LocaleSummaryItem,
    LocaleSummaryView
} from './lib/content/services/locale-group.service';
export type {
    ContentTypeCoverageView,
    I18nCoverageView,
    LocaleCoverageView
} from './lib/insights/types/i18n-insights-view';
