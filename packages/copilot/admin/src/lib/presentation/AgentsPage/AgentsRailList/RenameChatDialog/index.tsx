import { useEffect, useState, type FormEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    FieldError,
    FieldLabel,
    Input,
    Spinner
} from '@orthacms/design-system';
import type { CopilotConversation } from '../../../../application/useConversations';

/** Mirrors the server's `MAX_TITLE_LENGTH`, so the two agree on the limit. */
const MAX_TITLE_LENGTH = 200;

const messages = defineMessages({
    title: {
        id: 'copilot.agents.rename.title',
        defaultMessage: 'Rename chat'
    },
    description: {
        id: 'copilot.agents.rename.description',
        defaultMessage:
            'Chats are named after your first message. Give this one a name you will recognise.'
    },
    label: {
        id: 'copilot.agents.rename.label',
        defaultMessage: 'Chat name'
    },
    empty: {
        id: 'copilot.agents.rename.empty',
        defaultMessage: 'Enter a name.'
    },
    tooLong: {
        id: 'copilot.agents.rename.tooLong',
        defaultMessage: 'Use {max} characters or fewer.'
    },
    failed: {
        id: 'copilot.agents.rename.failed',
        defaultMessage: 'Could not rename the chat. Please try again.'
    },
    save: {
        id: 'copilot.agents.rename.save',
        defaultMessage: 'Save'
    },
    cancel: {
        id: 'copilot.agents.rename.cancel',
        defaultMessage: 'Cancel'
    }
});

export interface RenameChatDialogProps {
    /** The thread being renamed, or `null` when the dialog is closed. */
    conversation: CopilotConversation | null;
    /** True while the save is in flight. */
    saving: boolean;
    /** True when the last save failed. */
    failed: boolean;
    /** Commits the new name. */
    onSave(title: string): void;
    /** Closes without saving. */
    onClose(): void;
    /**
     * Puts focus back where it came from. Called from Radix's own
     * `onCloseAutoFocus`, with its default prevented — the dialog was opened
     * from a menu item that unmounted with its menu, so Radix's remembered
     * target is gone and its default lands focus on `<body>`.
     */
    onReturnFocus?(): void;
}

/**
 * Renaming, as a small dialog.
 *
 * A **dialog rather than an inline field in the row**: the row is 18rem wide and
 * already carries a title, a timestamp and a menu, so editing in place means
 * typing a sentence through a slot — and an input that appears inside a
 * navigation list is a control screen-reader users meet with no announcement
 * that the list has become a form. The dialog costs one keystroke more and is
 * unambiguous.
 *
 * Validation is deliberately the same rule the server enforces (non-blank, at
 * most 200 characters) stated once here, so the common mistakes never become a
 * round trip — but the server is still the enforcer, and its failure surfaces as
 * the error line rather than as a silent no-op.
 */
export function RenameChatDialog({
    conversation,
    saving,
    failed,
    onSave,
    onClose,
    onReturnFocus
}: RenameChatDialogProps) {
    const intl = useIntl();
    const [value, setValue] = useState('');
    const [touched, setTouched] = useState(false);

    // Seeded from the thread each time one is picked, not held across
    // openings: reopening the dialog on a different chat must not offer the
    // previous chat's name.
    useEffect(() => {
        setValue(conversation?.title ?? '');
        setTouched(false);
    }, [conversation]);

    const trimmed = value.trim();
    const error = !trimmed
        ? intl.formatMessage(messages.empty)
        : trimmed.length > MAX_TITLE_LENGTH
          ? intl.formatMessage(messages.tooLong, { max: MAX_TITLE_LENGTH })
          : null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (error || saving) {
            return;
        }
        onSave(trimmed);
    };

    return (
        <Dialog
            open={conversation !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent
                className="sm:max-w-md"
                onCloseAutoFocus={(event) => {
                    if (!onReturnFocus) return;
                    event.preventDefault();
                    onReturnFocus();
                }}
            >
                <form onSubmit={submit}>
                    <DialogHeader>
                        <DialogTitle>
                            {intl.formatMessage(messages.title)}
                        </DialogTitle>
                        <DialogDescription>
                            {intl.formatMessage(messages.description)}
                        </DialogDescription>
                    </DialogHeader>

                    <Field className="py-4" data-invalid={!!error && touched}>
                        <FieldLabel htmlFor="copilot-rename">
                            {intl.formatMessage(messages.label)}
                        </FieldLabel>
                        <Input
                            id="copilot-rename"
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            onBlur={() => setTouched(true)}
                            // Deliberately **no** `maxLength`: a hard cap
                            // silently swallows the tail of a pasted title, and
                            // the user is left wondering what happened to it.
                            // The message below says what the limit is instead.
                            aria-invalid={!!error && touched}
                            // The dialog is opened to type into, and Radix
                            // focuses its first focusable child anyway — this
                            // makes it the field rather than the close button.
                            autoFocus
                        />
                        {touched && error && <FieldError>{error}</FieldError>}
                        {failed && !error && (
                            <FieldError>
                                {intl.formatMessage(messages.failed)}
                            </FieldError>
                        )}
                    </Field>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        {/* Disabled only while saving — **not** on a validation
                            error. A greyed-out Save is a dead end: it refuses
                            without saying why, and on a field the user has not
                            blurred yet there is no message on screen either.
                            Submitting an invalid name marks it touched and
                            shows the reason, which is the only route to an
                            explanation. */}
                        <Button type="submit" disabled={saving}>
                            {saving && <Spinner className="size-4" />}
                            {intl.formatMessage(messages.save)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
