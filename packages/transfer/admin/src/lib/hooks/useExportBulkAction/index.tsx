import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Download } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import type {
    RecordsBulkActionEntry,
    RecordsBulkContext
} from '@orthacms/content-admin';
import { CONTENT_EXPORT } from '../../constants';
import { ExportDialog } from '../../components/ExportDialog';

const messages = defineMessages({
    export: { id: 'transfer.bulk.export', defaultMessage: 'Export' }
});

/**
 * The selection bar's **Export** button.
 *
 * Hidden in the trash view: exporting soft-deleted records would produce a file
 * that recreates them somewhere else as live content, which is not what "in the
 * trash" means anywhere else in the product.
 */
export function useExportBulkAction(
    context: RecordsBulkContext
): RecordsBulkActionEntry | null {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const canExport = useHasPermission(CONTENT_EXPORT);

    const overlay = (
        <ExportDialog
            open={open}
            onOpenChange={setOpen}
            typeName={context.schema.name}
            ids={context.ids}
            // The selection is cleared only once the download has happened —
            // clearing it on open would unmount the bar, and this dialog with it.
            onExported={context.onDone}
        />
    );

    if (!canExport || context.trashed || context.ids.length === 0) return null;

    return {
        label: intl.formatMessage(messages.export),
        icon: Download,
        onSelect: () => setOpen(true),
        overlay
    };
}
