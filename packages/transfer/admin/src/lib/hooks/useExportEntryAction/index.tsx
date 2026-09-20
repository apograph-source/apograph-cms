import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Download } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import type { EntryMenuEntry, EntrySlotContext } from '@orthacms/content-admin';
import { CONTENT_EXPORT } from '../../constants';
import { ExportDialog } from '../../components/ExportDialog';

const messages = defineMessages({
    export: { id: 'transfer.menu.exportEntry', defaultMessage: 'Export…' }
});

/**
 * The entry editor's **Export…** item, in the same Extras section as the i18n
 * plugin's "Publish all locales" — which is where the ask came from: acting on
 * the record you have open, beside the other actions that do.
 *
 * Returns `null` on a create form (there is no saved record to export yet) and
 * without the permission, which is how a slot item hides itself without
 * skipping its hook.
 */
export function useExportEntryAction(
    context: EntrySlotContext
): EntryMenuEntry | null {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const canExport = useHasPermission(CONTENT_EXPORT);

    const entryId = context.entry?.id;
    // The dialog is returned even when the item is hidden, so a dialog already
    // open survives the record being saved (create → edit swaps `isCreate`).
    const overlay = entryId ? (
        <ExportDialog
            open={open}
            onOpenChange={setOpen}
            typeName={context.schema.name}
            ids={[entryId]}
        />
    ) : null;

    if (!canExport || !entryId) return null;

    return {
        label: intl.formatMessage(messages.export),
        icon: Download,
        onSelect: () => setOpen(true),
        overlay
    };
}
