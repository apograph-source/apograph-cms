import { defineMessages, useIntl } from 'react-intl';
import { Button, Separator } from '@orthacms/design-system';
import { Copy, Download, FolderInput, Trash2, X } from 'lucide-react';

/** Intl descriptors for {@link MediaSelectionBar}, co-located. */
const messages = defineMessages({
    count: {
        id: 'media.selection.count',
        defaultMessage: '{count, plural, one {# selected} other {# selected}}'
    },
    download: { id: 'media.selection.download', defaultMessage: 'Download' },
    duplicate: { id: 'media.selection.duplicate', defaultMessage: 'Duplicate' },
    move: { id: 'media.selection.move', defaultMessage: 'Move' },
    delete: { id: 'media.selection.delete', defaultMessage: 'Delete' },
    clear: { id: 'media.selection.clear', defaultMessage: 'Clear selection' }
});

/**
 * The bulk-action bar shown once one or more assets are selected — a "{n}
 * selected" count and, permission-gated, Download / Duplicate / Move / Delete,
 * with a Clear control. The count is visual only (the bar mounts/unmounts with
 * the selection); the page owns any spoken announcement.
 */
export function MediaSelectionBar({
    count,
    onDownload,
    onDuplicate,
    onMove,
    onDelete,
    onClear,
    canCreate,
    canUpdate,
    canDelete
}: {
    count: number;
    onDownload: () => void;
    onDuplicate: () => void;
    onMove: () => void;
    onDelete: () => void;
    onClear: () => void;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
}) {
    const intl = useIntl();

    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2">
            <span className="text-sm font-medium">
                {intl.formatMessage(messages.count, { count })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="shadow-none"
                    onClick={onDownload}
                >
                    <Download aria-hidden />
                    {intl.formatMessage(messages.download)}
                </Button>
                {canCreate ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="shadow-none"
                        onClick={onDuplicate}
                    >
                        <Copy aria-hidden />
                        {intl.formatMessage(messages.duplicate)}
                    </Button>
                ) : null}
                {canUpdate ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="shadow-none"
                        onClick={onMove}
                    >
                        <FolderInput aria-hidden />
                        {intl.formatMessage(messages.move)}
                    </Button>
                ) : null}
                {canDelete ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive shadow-none hover:text-destructive"
                        onClick={onDelete}
                    >
                        <Trash2 aria-hidden />
                        {intl.formatMessage(messages.delete)}
                    </Button>
                ) : null}
                <Separator orientation="vertical" className="h-6" />
                <Button
                    variant="ghost"
                    size="sm"
                    className="shadow-none"
                    onClick={onClear}
                >
                    <X aria-hidden />
                    {intl.formatMessage(messages.clear)}
                </Button>
            </div>
        </div>
    );
}
