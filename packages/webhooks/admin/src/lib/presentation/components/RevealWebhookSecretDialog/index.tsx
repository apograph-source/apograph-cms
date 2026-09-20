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
        id: 'webhooks.reveal.title',
        defaultMessage: 'Copy your signing secret'
    },
    description: {
        id: 'webhooks.reveal.description',
        defaultMessage:
            'This is the only time the secret is shown. Your receiver needs it to verify that a delivery really came from this CMS.'
    },
    warning: {
        id: 'webhooks.reveal.warning',
        defaultMessage:
            'Every delivery is signed with this secret. Anyone who has it can forge a delivery your receiver will accept.'
    },
    rotated: {
        id: 'webhooks.reveal.rotated',
        defaultMessage:
            'The new secret is already in use, including for deliveries that were queued before the rotation. Put it in place on the receiver now.'
    },
    secretLabel: {
        id: 'webhooks.reveal.secretLabel',
        defaultMessage: 'Webhook signing secret'
    },
    copy: { id: 'webhooks.reveal.copy', defaultMessage: 'Copy' },
    copied: {
        id: 'webhooks.reveal.copied',
        defaultMessage: 'Copied to clipboard'
    },
    copyFailed: {
        id: 'webhooks.reveal.copyFailed',
        defaultMessage:
            'Couldn’t reach the clipboard. Select the secret above and copy it manually.'
    },
    done: { id: 'webhooks.reveal.done', defaultMessage: 'Done' },
    uncopied: {
        id: 'webhooks.reveal.uncopied',
        defaultMessage:
            'You haven’t copied the secret yet, and it can’t be shown again. Closing now means rotating to a new one.'
    },
    closeAnyway: {
        id: 'webhooks.reveal.closeAnyway',
        defaultMessage: 'Close without copying'
    },
    keepOpen: { id: 'webhooks.reveal.keepOpen', defaultMessage: 'Keep it open' }
});

/**
 * Shows a signing secret **once**.
 *
 * The secret cannot be hashed — it is used to sign, not to verify — so it lives
 * in the parent's state until this dialog is dismissed and is never fetchable
 * again. Three things follow, all of them load-bearing and all of them mirroring
 * the API-token reveal:
 *
 * - the secret is a focusable, labelled `readOnly` input that selects itself on
 *   focus, so it can be read and copied without the Copy button;
 * - the clipboard write is wrapped, because `writeText` rejects on an insecure
 *   origin, a denied permission, or an unfocused document — and a silent
 *   rejection loses the credential;
 * - dismissing before copying asks first, because Esc, the overlay and the
 *   close button are all reached by reflex.
 */
export function RevealWebhookSecretDialog({
    secret,
    rotated,
    open,
    onOpenChange
}: {
    /** The plaintext secret, or `null` when there is nothing to reveal. */
    secret: string | null;
    /** Whether this replaced an existing secret rather than minting the first. */
    rotated?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);

    // A new secret is a new chance to lose it — clear the guard whenever one
    // arrives, so a rotation does not inherit the first one's "copied".
    useEffect(() => {
        if (secret !== null) {
            setCopied(false);
            setConfirmingClose(false);
        }
    }, [secret]);

    const copy = async () => {
        if (!secret) return;
        try {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            toast.success(intl.formatMessage(messages.copied));
        } catch {
            toast.error(intl.formatMessage(messages.copyFailed));
        }
    };

    /** Close for real, clearing the guard. */
    const close = () => {
        setConfirmingClose(false);
        onOpenChange(false);
    };

    /** Every dismissal path funnels through here so none can slip past. */
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

                {/* `min-w-0` is load-bearing: `DialogContent` is a grid, whose
                    items default to `min-width: auto`, so without it the
                    unbreakable secret widens the row past the dialog and the
                    copy button lands outside the panel. */}
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
                        {intl.formatMessage(
                            rotated ? messages.rotated : messages.warning
                        )}
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
