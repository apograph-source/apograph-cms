import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    RadioGroup
} from '@orthacms/design-system';
import { Folder, Home } from 'lucide-react';
import { ROOT_FOLDER_ID } from '../../constants';
import type { MediaFolder } from '../../types/mediaFolder';
import { flattenFolderTree } from '../../utils/folderTree';
import { DestinationOption } from './DestinationOption';

/** Intl descriptors for {@link MoveAssetsDialog}, co-located. */
const messages = defineMessages({
    title: { id: 'media.move.title', defaultMessage: 'Move items' },
    description: {
        id: 'media.move.description',
        defaultMessage:
            'Choose a destination for {count, plural, one {# item} other {# items}}.'
    },
    root: { id: 'media.move.root', defaultMessage: 'All media' },
    cancel: { id: 'media.move.cancel', defaultMessage: 'Cancel' },
    move: { id: 'media.move.confirm', defaultMessage: 'Move here' }
});

/**
 * Modal that picks a destination folder for the given assets. Offers the root
 * ("All media") plus every folder as an indented radio list; the confirm is
 * disabled until a destination other than the assets' current folder is chosen.
 * The parent owns `open` and performs the move in `onMove`.
 */
export function MoveAssetsDialog({
    open,
    onOpenChange,
    folders,
    count,
    currentFolderId,
    onMove
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folders: MediaFolder[];
    /** Number of assets being moved (for the description). */
    count: number;
    /** Folder the assets currently live in — preselected, and a no-op target. */
    currentFolderId: string;
    onMove: (folderId: string) => void;
}) {
    const intl = useIntl();
    const [target, setTarget] = useState(currentFolderId);

    useEffect(() => {
        if (open) setTarget(currentFolderId);
    }, [open, currentFolderId]);

    const tree = flattenFolderTree(folders);

    const submit = () => {
        if (target === currentFolderId) return;
        onMove(target);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description, { count })}
                    </DialogDescription>
                </DialogHeader>
                <RadioGroup
                    value={target}
                    onValueChange={setTarget}
                    className="max-h-72 gap-0.5 overflow-auto rounded-lg border p-1"
                >
                    <DestinationOption
                        value={ROOT_FOLDER_ID}
                        depth={0}
                        icon={
                            <Home
                                className="size-4 text-muted-foreground"
                                aria-hidden
                            />
                        }
                        label={intl.formatMessage(messages.root)}
                        current={currentFolderId === ROOT_FOLDER_ID}
                    />
                    {tree.map(({ folder, depth }) => (
                        <DestinationOption
                            key={folder.id}
                            value={folder.id}
                            depth={depth + 1}
                            icon={
                                <Folder
                                    className="size-4 text-muted-foreground"
                                    aria-hidden
                                />
                            }
                            label={folder.name}
                            current={currentFolderId === folder.id}
                        />
                    ))}
                </RadioGroup>
                <DialogFooter className="mt-2">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={target === currentFolderId}
                    >
                        {intl.formatMessage(messages.move)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
