import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    ENTRY_MENU_GROUP,
    ENTRY_MENU_SLOT,
    RECORDS_BULK_ACTION_SLOT,
    RECORDS_MENU_SLOT,
    type EntryMenuItem,
    type RecordsBulkActionItem,
    type RecordsMenuItem
} from '@orthacms/content-admin';
import { EXPORT_MENU_ORDER, SLOT_ITEM_ID } from '../../constants';
import { useExportEntryAction } from '../../hooks/useExportEntryAction';
import { useExportBulkAction } from '../../hooks/useExportBulkAction';
import { useImportAction } from '../../hooks/useImportAction';

/**
 * Creates the transfer admin plugin — export and import in the content library.
 *
 * Contributes **no routes**: everything it does is an action on content someone
 * is already looking at, so it lives in the content library's own seams rather
 * than behind a page of its own. Three contributions, one per place the
 * question comes up:
 *
 * - the entry editor's ⋯ menu, beside "Publish all locales" — export this record
 * - the records selection bar — export what is selected
 * - the collection's own ⋯ menu, leftmost in the toolbar — import
 *
 * Register it **after** `contentAdminPlugin`, which declares all three slots.
 */
export function transferAdminPlugin(): AdminPlugin {
    const exportEntryItem: EntryMenuItem = {
        id: SLOT_ITEM_ID.ExportEntry,
        group: ENTRY_MENU_GROUP.Extras,
        order: EXPORT_MENU_ORDER,
        useItem: useExportEntryAction
    };
    const exportSelectionItem: RecordsBulkActionItem = {
        id: SLOT_ITEM_ID.ExportSelection,
        order: 10,
        useItem: useExportBulkAction
    };
    const importItem: RecordsMenuItem = {
        id: SLOT_ITEM_ID.Import,
        order: 10,
        useItem: useImportAction
    };

    return {
        name: 'transfer',
        slots: [
            { slot: ENTRY_MENU_SLOT, items: [exportEntryItem] },
            { slot: RECORDS_BULK_ACTION_SLOT, items: [exportSelectionItem] },
            { slot: RECORDS_MENU_SLOT, items: [importItem] }
        ]
    };
}
