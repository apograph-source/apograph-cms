import { defineMessages } from 'react-intl';
import type { AdminPlugin } from '@apograph/bootstrap-admin';
import {
    CONTENT_OVERLAY_SLOT,
    ENTRY_HEADER_SLOT,
    ENTRY_MENU_GROUP,
    ENTRY_MENU_SLOT,
    ENTRY_PARAMS_SLOT,
    ENTRY_SIDEBAR_WIDGET_SLOT,
    RECORDS_COLUMN_SLOT,
    RECORDS_FILTER_FIELDS_SLOT,
    RECORDS_TOOLBAR_SLOT,
    type ContentTypeDetail,
    type EntryRecord,
    type EntrySlotContext,
    type ContentOverlayItem,
    type EntryHeaderItem,
    type EntryMenuItem,
    type RecordsColumnItem,
    type RecordsToolbarItem,
    type EntrySidebarWidgetItem,
    type RecordsFilterFieldsItem,
    type EntryParamsItem
} from '@apograph/content-admin';
import {
    INSIGHTS_SECTION_IDS,
    INSIGHTS_WIDGET_SLOT
} from '@apograph/insights-admin';
import {
    CONTENT_READ,
    LOCALE_GROUP_PARAM,
    LOCALE_PARAM,
    SLOT_ITEM_ID
} from '../../constants';
import { useLocaleSummaries } from '../../api/useLocaleSummaries';
import { useLocaleFilterFields } from '../../hooks/useLocaleFilterFields';
import { usePublishAllLocales } from '../../hooks/usePublishAllLocales';
import { useUnpublishAllLocales } from '../../hooks/useUnpublishAllLocales';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import { LocalesColumnCell } from '../../components/LocalesColumnCell';
import { LocaleWidget } from '../../components/LocaleWidget';
import { LocaleTitleChip } from '../../components/LocaleTitleChip';
import { LocaleSwitchOverlay } from '../../components/LocaleSwitchOverlay';
import { LocalizationCoverageWidget } from '../../components/LocalizationCoverageWidget';

const messages = defineMessages({
    localesColumn: {
        id: 'i18n.column.header',
        defaultMessage: 'Locales'
    }
});

/** The plugin object shape returned by {@link I18nPlugin}. */
export type I18nAdminPlugin = AdminPlugin;

/**
 * Creates the i18n admin plugin — content localization for the Content
 * Library. Contributes **only** to `@apograph/content-admin`'s extension
 * slots (no routes, no layout, no nav):
 *
 * - a searchable **locale switcher** in the records toolbar (owns the
 *   `?locale=` list param; the server scopes the list to it, defaulting to
 *   the default locale);
 * - an optional **Locales** table column — per-row badges of the translation
 *   group's locales with publish status, batch-loaded per page;
 * - the **locale panel** in the entry editor's sidebar (per-locale status,
 *   open a sibling, create a translation);
 * - a **current-locale chip** beside the entry-editor title;
 * - **Has locale / Missing locale / Locale count** filter fields;
 * - entry param plumbing: the single-page read and the create body carry the
 *   active locale, and relation-picker candidates are scoped to the source
 *   entry's locale with default-locale fallback.
 *
 * Register it **after** `ContentPlugin()` in `createAdmin({ plugins })` — it
 * contributes only to slots the content plugin owns.
 */
export function I18nPlugin(): I18nAdminPlugin {
    // Each item is typed explicitly so the callback parameters infer — the
    // AdminPlugin `slots` array is heterogeneous (`SlotContribution<unknown>`),
    // so a bare object literal wouldn't be contextually typed by its slot.
    const switcherItem: RecordsToolbarItem = {
        id: SLOT_ITEM_ID.Switcher,
        listParamKeys: [LOCALE_PARAM],
        Component: LocaleSwitcher
    };
    const columnItem: RecordsColumnItem = {
        id: SLOT_ITEM_ID.Column,
        label: messages.localesColumn,
        appliesTo: (schema: ContentTypeDetail) => !!schema.i18n,
        // Called from the records view's per-render item loop — safe because
        // slot items are boot-frozen. Gated on the schema being i18n **and**
        // on the column being switched on: it is off by default, so without
        // the second gate every records page of every localized type POSTed a
        // batch of its translation-group ids for a column nobody had asked to
        // see.
        useRowsData: (
            entries: EntryRecord[],
            schema: ContentTypeDetail,
            _workspaceId: string,
            isVisible: boolean
        ) =>
            useLocaleSummaries(
                schema.name,
                entries.map((entry) => entry.localeGroupId),
                !!schema.i18n && isVisible
            ),
        Cell: LocalesColumnCell
    };
    const widgetItem: EntrySidebarWidgetItem = {
        id: SLOT_ITEM_ID.Widget,
        Component: LocaleWidget
    };
    const titleChipItem: EntryHeaderItem = {
        id: SLOT_ITEM_ID.TitleChip,
        Component: LocaleTitleChip
    };
    // Page-level, not inside the editor: the cover has to stay mounted while
    // the destination record loads — which is exactly when the editor (and any
    // widget inside it) is unmounted for its loading state.
    const switchOverlayItem: ContentOverlayItem = {
        id: SLOT_ITEM_ID.SwitchOverlay,
        Component: LocaleSwitchOverlay
    };
    const filterFieldsItem: RecordsFilterFieldsItem = {
        id: SLOT_ITEM_ID.FilterFields,
        useFields: useLocaleFilterFields
    };
    const entryParamsItem: EntryParamsItem = {
        id: SLOT_ITEM_ID.EntryParams,
        // A single page resolves its row by the active locale.
        listParamKeys: [LOCALE_PARAM],
        // A create stamps the locale it was opened under, and (when creating a
        // translation via the locale widget) joins the row to that group.
        createBodyKeys: [LOCALE_PARAM, LOCALE_GROUP_PARAM],
        // Relation candidates are scoped **strictly** to the active locale —
        // cross-locale linking isn't allowed, so no default fallback. The locale
        // is the saved entry's (edit mode) or the create form's `?locale=` (a
        // translation draft has no `entry` yet). A fresh default-locale create
        // resolves nothing → `{}` → the server scopes to the default locale.
        relationCandidateParams: (
            targetSchema: ContentTypeDetail,
            source: EntrySlotContext
        ): Record<string, string> => {
            const locale =
                source.entry?.locale ?? source.params?.[LOCALE_PARAM];
            return targetSchema.i18n && locale
                ? { [LOCALE_PARAM]: locale }
                : {};
        }
    };
    // The editor's ⋯ menu, in its own section: act on every locale of the open
    // record at once. Each hook resolves the siblings itself and returns null
    // when it doesn't apply (not localized, not publishable, unsaved, no
    // permission), which is how a menu item hides without skipping its hook.
    const publishAllItem: EntryMenuItem = {
        id: SLOT_ITEM_ID.PublishAll,
        group: ENTRY_MENU_GROUP.Extras,
        order: 10,
        useItem: usePublishAllLocales
    };
    const unpublishAllItem: EntryMenuItem = {
        id: SLOT_ITEM_ID.UnpublishAll,
        group: ENTRY_MENU_GROUP.Extras,
        order: 20,
        useItem: useUnpublishAllLocales
    };
    return {
        name: 'i18n',
        slots: [
            {
                // The one contribution that is not to a content-admin slot:
                // localization coverage is a question about the *configured*
                // locale set, which only this plugin knows, so this plugin owns
                // the card. `full` width — it shares the Localisation & media
                // band with media's three `sm` cards, which fill their own row.
                slot: INSIGHTS_WIDGET_SLOT,
                items: [
                    {
                        id: SLOT_ITEM_ID.CoverageWidget,
                        section: INSIGHTS_SECTION_IDS.Reach,
                        order: 5,
                        size: 'full',
                        permission: CONTENT_READ,
                        titleId: 'i18n.insights.coverage.title',
                        defaultTitle: 'Translation coverage',
                        Component: LocalizationCoverageWidget
                    }
                ]
            },
            { slot: RECORDS_TOOLBAR_SLOT, items: [switcherItem] },
            { slot: RECORDS_COLUMN_SLOT, items: [columnItem] },
            { slot: ENTRY_SIDEBAR_WIDGET_SLOT, items: [widgetItem] },
            {
                slot: ENTRY_MENU_SLOT,
                items: [publishAllItem, unpublishAllItem]
            },
            { slot: ENTRY_HEADER_SLOT, items: [titleChipItem] },
            { slot: CONTENT_OVERLAY_SLOT, items: [switchOverlayItem] },
            { slot: RECORDS_FILTER_FIELDS_SLOT, items: [filterFieldsItem] },
            { slot: ENTRY_PARAMS_SLOT, items: [entryParamsItem] }
        ]
    };
}
