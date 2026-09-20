import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    InputField
} from '@orthacms/design-system';

/** Intl descriptors for {@link RenameDialog}, co-located. */
const messages = defineMessages({
    title: { id: 'media.rename.title', defaultMessage: 'Rename' },
    label: { id: 'media.rename.label', defaultMessage: 'Name' },
    cancel: { id: 'media.rename.cancel', defaultMessage: 'Cancel' },
    save: { id: 'media.rename.save', defaultMessage: 'Save' }
});

/**
 * A single-field rename modal reused for assets and folders. The parent supplies
 * the current name and performs the rename in `onRename`; the field seeds from
 * `currentName` each time it opens and the confirm is disabled while blank or
 * unchanged. Selecting the text on open makes an in-place edit quick.
 */
export function RenameDialog({
    open,
    onOpenChange,
    currentName,
    onRename
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentName: string;
    onRename: (name: string) => void;
}) {
    const intl = useIntl();
    const [name, setName] = useState(currentName);

    useEffect(() => {
        if (open) setName(currentName);
    }, [open, currentName]);

    const trimmed = name.trim();
    const changed = trimmed.length > 0 && trimmed !== currentName;

    const submit = () => {
        if (!changed) return;
        onRename(trimmed);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <InputField
                        id="media-rename-name"
                        label={intl.formatMessage(messages.label)}
                        value={name}
                        autoFocus
                        onFocus={(event) => event.target.select()}
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
                        <Button type="submit" disabled={!changed}>
                            {intl.formatMessage(messages.save)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
