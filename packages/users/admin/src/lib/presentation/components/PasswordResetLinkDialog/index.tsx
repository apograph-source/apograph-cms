import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@orthacms/design-system';
import { TriangleAlert } from 'lucide-react';
import { PasswordResetLinkPanel } from '../PasswordResetLinkPanel';

/** Intl descriptors for {@link PasswordResetLinkDialog}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'users.passwordResetLinkDialog.title',
        defaultMessage: 'Send this link to {email}'
    },
    description: {
        id: 'users.passwordResetLinkDialog.description',
        defaultMessage:
            'Any earlier reset link stopped working the moment this one was created, so this is the link they need. It’s shown once — copy it before you close this.'
    },
    done: {
        id: 'users.passwordResetLinkDialog.done',
        defaultMessage: 'Done'
    },
    uncopied: {
        id: 'users.passwordResetLinkDialog.uncopied',
        defaultMessage:
            'You haven’t copied the link yet, and it can’t be shown again. Closing now leaves {email} with no way to reset until you generate another one.'
    },
    closeAnyway: {
        id: 'users.passwordResetLinkDialog.closeAnyway',
        defaultMessage: 'Close without copying'
    },
    keepOpen: {
        id: 'users.passwordResetLinkDialog.keepOpen',
        defaultMessage: 'Keep it open'
    }
});

/** Props for {@link PasswordResetLinkDialog}. */
type PasswordResetLinkDialogProps = {
    /** The freshly minted reset link, or `null` when there is none to show. */
    link: string | null;
    /** Whose account the link resets. */
    email: string;
    /** Whether the dialog is open. */
    open: boolean;
    /** Called when the dialog opens or closes. */
    onOpenChange: (open: boolean) => void;
};

/**
 * Shows the password-reset link an admin just generated. Generating rotates the
 * token, which kills any link already outstanding — so handing the new one over
 * is not a nicety, it is the rest of the operation.
 *
 * Because of that, dismissing before copying is guarded. Esc, an overlay click
 * and the close button all reach `onOpenChange(false)` by reflex, and the link
 * is not re-fetchable: losing it leaves the member with no way to reset and the
 * admin with no live link, recoverable only by generating another — which the
 * server refuses for the first minute, so the mistake is not even immediately
 * fixable. So the first dismissal without a copy asks; once copied, it closes
 * freely.
 */
export function PasswordResetLinkDialog({
    link,
    email,
    open,
    onOpenChange
}: PasswordResetLinkDialogProps) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);

    // A new link is a new chance to lose it — reset the guard whenever one
    // arrives, so a second generate doesn't inherit the first one's "copied".
    useEffect(() => {
        if (link !== null) {
            setCopied(false);
            setConfirmingClose(false);
        }
    }, [link]);

    /** Close for real, clearing the guard. */
    const close = () => {
        setConfirmingClose(false);
        onOpenChange(false);
    };

    /** Every dismissal path funnels through here so none of them can slip past. */
    const requestClose = () => {
        if (copied) {
            close();
            return;
        }
        setConfirmingClose(true);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    onOpenChange(true);
                    return;
                }
                requestClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title, { email })}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                {link && (
                    <PasswordResetLinkPanel
                        link={link}
                        email={email}
                        onCopied={() => setCopied(true)}
                    />
                )}

                {confirmingClose ? (
                    <Alert variant="destructive" role="alert">
                        <TriangleAlert aria-hidden />
                        <AlertDescription>
                            {intl.formatMessage(messages.uncopied, { email })}
                        </AlertDescription>
                    </Alert>
                ) : null}

                <DialogFooter>
                    {confirmingClose ? (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setConfirmingClose(false)}
                            >
                                {intl.formatMessage(messages.keepOpen)}
                            </Button>
                            <Button variant="destructive" onClick={close}>
                                {intl.formatMessage(messages.closeAnyway)}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={requestClose}>
                            {intl.formatMessage(messages.done)}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
