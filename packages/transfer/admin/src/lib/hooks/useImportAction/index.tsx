import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Upload } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import type {
    RecordsMenuContext,
    RecordsMenuEntry
} from '@orthacms/content-admin';
import { CONTENT_IMPORT } from '../../constants';
import { ImportDialog } from '../../components/ImportDialog';

const messages = defineMessages({
    import: { id: 'transfer.menu.import', defaultMessage: 'Import…' }
});

/**
 * The collection ⋯ menu's **Import…** item.
 *
 * It belongs to the collection, not to a selection: nothing is selected when
 * you import, and what arrives is whatever the file holds. Nor does it belong
 * beside search and filters — importing is an occasional operation, and the
 * controls people use on every visit should not give up width to it.
 *
 * Hidden in the trash view: importing into a bin is not a thing, and the rows
 * there are on their way out.
 */
export function useImportAction(
    context: RecordsMenuContext
): RecordsMenuEntry | null {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const canImport = useHasPermission(CONTENT_IMPORT);

    // Returned even when the item is hidden, so a dialog already open survives
    // a switch into the trash view rather than vanishing mid-interaction.
    const overlay = (
        <ImportDialog
            open={open}
            onOpenChange={setOpen}
            typeName={context.schema.name}
            workspaceId={context.workspaceId}
        />
    );

    if (!canImport || context.trashed) return null;

    return {
        label: intl.formatMessage(messages.import),
        icon: Upload,
        onSelect: () => setOpen(true),
        overlay
    };
}
