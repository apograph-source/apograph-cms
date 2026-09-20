import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import { FolderOpen, MoreVertical, Pencil, Trash2 } from 'lucide-react';

/** Intl descriptors for {@link FolderActionsMenu}, co-located. */
const messages = defineMessages({
    trigger: {
        id: 'media.folder.actions.trigger',
        defaultMessage: 'Actions for {name}'
    },
    open: { id: 'media.folder.actions.open', defaultMessage: 'Open' },
    rename: { id: 'media.folder.actions.rename', defaultMessage: 'Rename' },
    delete: { id: 'media.folder.actions.delete', defaultMessage: 'Delete' }
});

/**
 * The per-folder action menu — Open, Rename, and a destructive Delete (which
 * removes the folder and everything inside). Rename/Delete are hidden unless the
 * caller passes the matching permission. Pass `trigger` to override the default ⋯.
 */
export function FolderActionsMenu({
    name,
    onOpen,
    onRename,
    onDelete,
    canUpdate,
    canDelete,
    trigger
}: {
    /**
     * The folder this menu acts on — its name goes in the trigger's accessible
     * name, so a grid of folders doesn't present a row of buttons all called
     * "Folder actions" with nothing to tell them apart.
     */
    name: string;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
    canUpdate: boolean;
    canDelete: boolean;
    trigger?: ReactNode;
}) {
    const intl = useIntl();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger ?? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shadow-none"
                        aria-label={intl.formatMessage(messages.trigger, {
                            name
                        })}
                    >
                        <MoreVertical aria-hidden />
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={onOpen}>
                    <FolderOpen aria-hidden />
                    {intl.formatMessage(messages.open)}
                </DropdownMenuItem>
                {canUpdate ? (
                    <DropdownMenuItem onSelect={onRename}>
                        <Pencil aria-hidden />
                        {intl.formatMessage(messages.rename)}
                    </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={onDelete}
                        >
                            <Trash2 aria-hidden />
                            {intl.formatMessage(messages.delete)}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
