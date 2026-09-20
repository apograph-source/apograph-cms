import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    toast
} from '@orthacms/design-system';

const messages = defineMessages({
    title: {
        id: 'apiTokens.reveal.title',
        defaultMessage: 'Copy your API token'
    },
    description: {
        id: 'apiTokens.reveal.description',
        defaultMessage:
            'This is the only time the token is shown. Store it somewhere safe — you won’t be able to see it again.'
    },
    warning: {
        id: 'apiTokens.reveal.warning',
        defaultMessage:
            'Treat this token like a password. Anyone with it can read this workspace’s content.'
    },
    secretLabel: {
        id: 'apiTokens.reveal.secretLabel',
        defaultMessage: 'API token secret'
    },
    copy: {
        id: 'apiTokens.reveal.copy',
        defaultMessage: 'Copy'
    },
    copied: {
        id: 'apiTokens.reveal.copied',
        defaultMessage: 'Copied to clipboard'
    },
    copyFailed: {
        id: 'apiTokens.reveal.copyFailed',
        defaultMessage:
            'Couldn’t reach the clipboard. Select the token above and copy it manually.'
    },
    done: {
        id: 'apiTokens.reveal.done',
        defaultMessage: 'Done'
    },
    uncopied: {
        id: 'apiTokens.reveal.uncopied',
        defaultMessage:
            'You haven’t copied the token yet, and it can’t be shown again. Closing now means minting a replacement.'
    },
    closeAnyway: {
        id: 'apiTokens.reveal.closeAnyway',
        defaultMessage: 'Close without copying'
    },
    keepOpen: {
        id: 'apiTokens.reveal.keepOpen',
        defaultMessage: 'Keep it open'
    }
});

/**
 * Shows a freshly minted token's plaintext **once**. The secret lives only in
 * the parent's state until the dialog is dismissed; it is never re-fetchable, so
 * this is the single chance to copy it.
 *
 * Because of that, three things are load-bearing rather than decorative, and all
 * three mirror the equivalent one-time invite link in `users/admin`
 * (`InviteLinkPanel` / `InviteLinkDialog`):
 *
 * - the secret is a focusable, labelled `readOnly` input that selects itself on
 *   focus, so a keyboard or screen-reader user can read and copy it **without**
 *   the Copy button;
 * - the clipboard write is wrapped, because `navigator.clipboard.writeText`
 *   rejects on an insecure origin, a denied permission, or an unfocused
 *   document — and a silent rejection loses the credential outright;
 * - dismissing before copying asks first, since Esc, the overlay and the close
 *   button all reach `onOpenChange(false)` by reflex.
 */
export function RevealSecretDialog({
    secret,
    open,
    onOpenChange
}: {
    /** The plaintext token, or `null` when there is nothing to reveal. */
    secret: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);

    // A new secret is a new chance to lose it — clear the guard whenever one
    // arrives, so a second mint doesn't inherit the first one's "copied".
    useEffect(() => {
        if (secret !== null) {
            setCopied(false);
            setConfirmingClose(false);
        }
    }, [secret]);

    const copy = async () => {
        if (!secret) {
            return;
        }
        try {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            toast.success(intl.formatMessage(messages.copied));
        } catch {
            // Clipboard access can be refused (insecure origin, denied
            // permission, unfocused document). The secret is selectable in the
            // field above, so say so rather than failing silently — this is the
            // only copy of the credential.
            toast.error(intl.formatMessage(messages.copyFailed));
        }
    };

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
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                {/* `min-w-0` on the row is load-bearing: `DialogContent` is a
                    grid, whose items default to `min-width: auto`, so without it
                    the unbreakable token string widens this row past the
                    dialog's `max-w-lg` and the copy button lands outside the
                    panel. With it the row can shrink and the field below scrolls
                    its own value instead. The button is `shrink-0` so the field —
                    not the control — gives up the space. */}
                <div className="flex min-w-0 items-center gap-2">
                    <input
                        readOnly
                        value={secret ?? ''}
                        aria-label={intl.formatMessage(messages.secretLabel)}
                        onFocus={(event) => event.currentTarget.select()}
                        className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={copy}
                    >
                        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                        {intl.formatMessage(messages.copy)}
                    </Button>
                </div>

                <Alert>
                    <TriangleAlert aria-hidden />
                    <AlertDescription>
                        {intl.formatMessage(messages.warning)}
                    </AlertDescription>
                </Alert>

                {confirmingClose ? (
                    <Alert variant="destructive" role="alert">
                        <TriangleAlert aria-hidden />
                        <AlertDescription>
                            {intl.formatMessage(messages.uncopied)}
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
