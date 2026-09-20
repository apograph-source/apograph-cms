import { DynamicModule, Module } from '@nestjs/common';
import { CONTENT_ENTRY_EXTENSION } from '@orthacms/content-server';
import { copilotAppliersRegistrar } from '@orthacms/copilot-server';
import { I18N_CONFIG } from './i18n.constants';
import type { I18nPluginConfig } from './types/locale';
import { LocaleRegistryService } from './locales/services/locale-registry.service';
import { OrphanedLocaleChecker } from './locales/services/orphaned-locale.checker';
import { ListLocalesController } from './locales/controllers/list-locales.controller';
import { EntryLocaleExtensionService } from './content/services/entry-locale-extension.service';
import { LocaleGroupService } from './content/services/locale-group.service';
import { GetEntryLocalesController } from './content/controllers/get-entry-locales.controller';
import { LocaleSummaryController } from './content/controllers/locale-summary.controller';
import { LocalizationCoverageQuery } from './insights/infrastructure/queries/localization-coverage.query';
import { LocalizationCoverageController } from './insights/http/controllers/localization-coverage.controller';
import { I18nCopilotToolProvider } from './copilot/i18n-tool.provider';
import { TranslationProposalToolProvider } from './copilot/translation-proposal.provider';
import {
    BulkTranslationProposalApplier,
    TranslationProposalApplier
} from './copilot/translation-proposal.applier';

/**
 * NestJS module of the i18n plugin. Registered **global** so its binding of
 * content-server's `CONTENT_ENTRY_EXTENSION` port resolves inside the
 * (equally global) content module without an explicit import — the same
 * inversion as content binding identity's `CONTENT_CATALOG`, roles swapped:
 * content declares the port, this plugin provides the implementation.
 */
@Module({})
export class I18nModule {
    /** Creates the global dynamic module around a validated config. */
    static forRoot(config: I18nPluginConfig): DynamicModule {
        return {
            module: I18nModule,
            global: true,
            controllers: [
                ListLocalesController,
                // Reads only: the per-entry locale panel and the records
                // table's batched group summary. Sibling *creation* goes
                // through `POST /api/content/:type` with a `localeGroupId`
                // (the extension stamps the group), so this plugin owns no
                // entry-write route.
                GetEntryLocalesController,
                LocaleSummaryController,
                // The Insights read-model. Mounted under `insights/` with
                // content's and media's, not this plugin's `i18n/` prefix —
                // one card, one endpoint, grouped by what they are.
                LocalizationCoverageController
            ],
            providers: [
                { provide: I18N_CONFIG, useValue: config },
                LocaleRegistryService,
                // Boot-time diff of the configured locale set against what the
                // data actually holds — the one locale change (a removal) that
                // otherwise fails silently.
                OrphanedLocaleChecker,
                LocaleGroupService,
                LocalizationCoverageQuery,
                EntryLocaleExtensionService,
                {
                    provide: CONTENT_ENTRY_EXTENSION,
                    useExisting: EntryLocaleExtensionService
                },
                // The copilot's locale tools. Both no-op when no copilot
                // plugin is registered — the registrar injects the registry
                // optionally.
                I18nCopilotToolProvider,
                TranslationProposalToolProvider,
                // The appliers for the kinds those propose tools produce —
                // one per kind, next to them on purpose: a missing applier
                // surfaces only when a change is carried out.
                TranslationProposalApplier,
                BulkTranslationProposalApplier,
                copilotAppliersRegistrar(
                    'i18n',
                    TranslationProposalApplier,
                    BulkTranslationProposalApplier
                )
            ],
            exports: [CONTENT_ENTRY_EXTENSION, LocaleRegistryService]
        };
    }
}
