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
import {
    Copy,
    Download,
    FolderInput,
    Link2,
    MoreVertical,
    Pencil,
    Trash2
} from 'lucide-react';

/** The set of actions offered for a single asset (each permission-gated). */
export type AssetActionHandlers = {
    onDownload: () => void;
    onCopyLink: () => void;
    onDuplicate: () => void;
    onRename: () => void;
    onMove: () => void;
    onDelete: () => void;
};

/** One asset action, used as the discriminant of a single dispatch callback. */
export type AssetActionKind =
    | 'open'
    | 'download'
    | 'copyLink'
    | 'duplicate'
    | 'rename'
    | 'move'
    | 'delete';

/** Intl descriptors for {@link AssetActionsMenu}, co-located. */
const messages = defineMessages({
    trigger: {
        id: 'media.asset.actions.trigger',
        defaultMessage: 'Asset actions'
    },
    /**
     * The trigger's name when the caller knows which asset it belongs to. A
     * grid of twenty tiles otherwise offers twenty buttons all called "Asset
     * actions", which is the same defect the folder cards already fixed.
     */
    triggerFor: {
        id: 'media.asset.actions.triggerFor',
        defaultMessage: 'Actions for {name}'
    },
    download: {
        id: 'media.asset.actions.download',
        defaultMessage: 'Download'
    },
    copyLink: {
        id: 'media.asset.actions.copyLink',
        defaultMessage: 'Copy link'
    },
    duplicate: {
        id: 'media.asset.actions.duplicate',
        defaultMessage: 'Duplicate'
    },
    rename: { id: 'media.asset.actions.rename', defaultMessage: 'Rename' },
    move: { id: 'media.asset.actions.move', defaultMessage: 'Move to…' },
    delete: { id: 'media.asset.actions.delete', defaultMessage: 'Delete' }
});

/**
 * The per-asset action menu — Download, Copy link, Duplicate, Rename, Move, and
 * a destructive Delete. Shared by the grid tile and the detail drawer so the
 * action set stays identical everywhere. Write actions are hidden unless the
 * caller passes the matching permission (`canCreate` for Duplicate, `canUpdate`
 * for Rename/Move, `canDelete` for Delete). Pass `trigger` to override the
 * default ⋯ button.
 *
 * There is deliberately **no "Open" item**. In the drawer it re-opened the
 * drawer you were already reading — a visible no-op — and on the tile it
 * duplicated the two controls that already open the detail (the thumbnail and
 * the filename are both buttons). The `'open'` action kind still exists; those
 * two controls dispatch it.
 */
export function AssetActionsMenu({
    handlers,
    assetName,
    canCreate,
    canUpdate,
    canDelete,
    trigger,
    align = 'end'
}: {
    handlers: AssetActionHandlers;
    /** Names the default trigger ("Actions for hero.png"); omit in a drawer. */
    assetName?: string;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    trigger?: ReactNode;
    align?: 'start' | 'center' | 'end';
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
                        aria-label={
                            assetName
                                ? intl.formatMessage(messages.triggerFor, {
                                      name: assetName
                                  })
                                : intl.formatMessage(messages.trigger)
                        }
                    >
                        <MoreVertical aria-hidden />
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="w-48">
                <DropdownMenuItem onSelect={handlers.onDownload}>
                    <Download aria-hidden />
                    {intl.formatMessage(messages.download)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handlers.onCopyLink}>
                    <Link2 aria-hidden />
                    {intl.formatMessage(messages.copyLink)}
                </DropdownMenuItem>
                {canCreate ? (
                    <DropdownMenuItem onSelect={handlers.onDuplicate}>
                        <Copy aria-hidden />
                        {intl.formatMessage(messages.duplicate)}
                    </DropdownMenuItem>
                ) : null}
                {canUpdate ? (
                    <>
                        <DropdownMenuItem onSelect={handlers.onRename}>
                            <Pencil aria-hidden />
                            {intl.formatMessage(messages.rename)}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handlers.onMove}>
                            <FolderInput aria-hidden />
                            {intl.formatMessage(messages.move)}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {canDelete ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={handlers.onDelete}
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
