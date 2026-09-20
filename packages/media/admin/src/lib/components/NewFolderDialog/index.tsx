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
    InputField
} from '@orthacms/design-system';

/** Intl descriptors for {@link NewFolderDialog}, co-located. */
const messages = defineMessages({
    title: { id: 'media.newFolder.title', defaultMessage: 'New folder' },
    description: {
        id: 'media.newFolder.description',
        defaultMessage:
            'Folders help you organise assets. It will be created in {location}.'
    },
    label: { id: 'media.newFolder.label', defaultMessage: 'Folder name' },
    placeholder: {
        id: 'media.newFolder.placeholder',
        defaultMessage: 'e.g. Campaign assets'
    },
    cancel: { id: 'media.newFolder.cancel', defaultMessage: 'Cancel' },
    create: { id: 'media.newFolder.create', defaultMessage: 'Create folder' }
});

/**
 * Modal that collects a name and creates a folder in the current location. The
 * parent owns `open` and performs the create in `onCreate`; the field seeds
 * empty on each open and the confirm is disabled until it is non-blank.
 */
export function NewFolderDialog({
    open,
    onOpenChange,
    locationLabel,
    onCreate
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Human name of the folder the new one lands in (e.g. "All media"). */
    locationLabel: string;
    onCreate: (name: string) => void;
}) {
    const intl = useIntl();
    const [name, setName] = useState('');

    useEffect(() => {
        if (open) setName('');
    }, [open]);

    const trimmed = name.trim();

    const submit = () => {
        if (!trimmed) return;
        onCreate(trimmed);
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
                        {intl.formatMessage(messages.description, {
                            location: locationLabel
                        })}
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <InputField
                        id="media-new-folder-name"
                        label={intl.formatMessage(messages.label)}
                        placeholder={intl.formatMessage(messages.placeholder)}
                        value={name}
                        autoFocus
                        onChange={(event) => setName(event.target.value)}
                    />
                    <DialogFooter className="mt-6">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button type="submit" disabled={!trimmed}>
                            {intl.formatMessage(messages.create)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
