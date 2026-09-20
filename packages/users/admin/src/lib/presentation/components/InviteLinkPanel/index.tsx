import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    toast
} from '@orthacms/design-system';

/** Intl descriptors for {@link InviteLinkPanel}, co-located with the component. */
const messages = defineMessages({
    copy: {
        id: 'users.inviteLink.copy',
        defaultMessage: 'Copy link'
    },
    copied: {
        id: 'users.inviteLink.copied',
        defaultMessage: 'Invite link copied to clipboard'
    },
    copyFailed: {
        id: 'users.inviteLink.copyFailed',
        defaultMessage:
            'Couldn’t reach the clipboard. Select the link and copy it manually.'
    },
    warning: {
        id: 'users.inviteLink.warning',
        defaultMessage:
            'This link is shown once and works once. Anyone who opens it becomes {email} — send it the way you’d send a password, not in a public channel.'
    },
    linkLabel: {
        id: 'users.inviteLink.linkLabel',
        defaultMessage: 'Invite link for {email}'
    }
});

/** Props for {@link InviteLinkPanel}. */
type InviteLinkPanelProps = {
    /** The full invite URL to hand over. */
    link: string;
    /** Who the link is for — named in the warning so the risk is concrete. */
    email: string;
    /**
     * Called once the link has actually reached the clipboard. Lets a container
     * tell "captured" from "about to be lost" — the resend dialog guards its
     * dismissal on it.
     */
    onCopied?: () => void;
};

/**
 * The reveal-once invite link, with a copy button and a plain warning about
 * what the link is. Mirrors the API-token reveal dialog: the secret exists only
 * in the caller's state, is never re-fetchable, and this is the single chance to
 * capture it.
 *
 * It exists because nothing emails invites yet — the admin is the delivery
 * channel. When a mailer lands (identity epic #11) this becomes a fallback for
 * deployments with no SMTP rather than the only path.
 */
export function InviteLinkPanel({
    link,
    email,
    onCopied
}: InviteLinkPanelProps) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            onCopied?.();
            toast.success(intl.formatMessage(messages.copied));
        } catch {
            // Clipboard access can be denied (insecure origin, permissions).
            // The link is selectable in the field, so say so rather than
            // failing silently.
            toast.error(intl.formatMessage(messages.copyFailed));
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* `min-w-0` on the row lets the unbreakable URL shrink instead of
                widening its container past the panel; the button is `shrink-0`
                so the link — not the control — gives up the space. */}
            <div className="flex min-w-0 items-center gap-2">
                <input
                    readOnly
                    value={link}
                    aria-label={intl.formatMessage(messages.linkLabel, {
                        email
                    })}
                    onFocus={(e) => e.currentTarget.select()}
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
                    {intl.formatMessage(messages.warning, { email })}
                </AlertDescription>
            </Alert>
        </div>
    );
}
