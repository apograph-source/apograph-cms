import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { KeyRound } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Spinner,
    toast
} from '@apograph/design-system';
import { useHasPermission } from '@apograph/identity-admin';
import { HTTP_STATUS } from '@apograph/utils-admin';
import { useIssuePasswordReset } from '../../../application/useIssuePasswordReset';
import { passwordResetLinkFor } from '../../../infrastructure/passwordResetLink';
import type { Member } from '../../../domain/types/member';
import { PasswordResetLinkDialog } from '../PasswordResetLinkDialog';

/** Intl descriptors for {@link PasswordResetCard}, co-located with the component. */
const messages = defineMessages({
    title: { id: 'users.passwordReset.title', defaultMessage: 'Password' },
    body: {
        id: 'users.passwordReset.body',
        defaultMessage:
            'Generate a single-use link this member can open to set a new password. Nothing changes until they use it; when they do, every device signed in to their account is signed out.'
    },
    deliveryNote: {
        id: 'users.passwordReset.deliveryNote',
        defaultMessage:
            'If this install sends mail, the link goes to them by email; otherwise you copy it and send it yourself. Generating a new link stops any earlier one from working.'
    },
    mailed: {
        id: 'users.passwordReset.mailed',
        defaultMessage: 'A reset link is on its way to {email}.'
    },
    generate: {
        id: 'users.passwordReset.generate',
        defaultMessage: 'Generate reset link'
    },
    generating: {
        id: 'users.passwordReset.generating',
        defaultMessage: 'Generating reset link…'
    },
    pending: {
        id: 'users.passwordReset.pending',
        defaultMessage:
            'This member hasn’t accepted their invite, so there’s no password to reset. Resend their invite instead.'
    },
    disabled: {
        id: 'users.passwordReset.disabled',
        defaultMessage:
            'This member is suspended and can’t sign in, so a reset link would do nothing. Reactivate them first.'
    },
    noPermission: {
        id: 'users.passwordReset.noPermission',
        defaultMessage:
            'You don’t have permission to reset another member’s password.'
    },
    recentlyIssued: {
        id: 'users.passwordReset.recentlyIssued',
        defaultMessage:
            'A reset link was just generated for this member. Wait {seconds, plural, one {a second} other {# seconds}} — generating another now would kill the one you already have.'
    },
    conflict: {
        id: 'users.passwordReset.conflict',
        defaultMessage:
            'This member’s account changed while you were looking at it. Reload the page and try again.'
    },
    failed: {
        id: 'users.passwordReset.failed',
        defaultMessage: 'Couldn’t generate a reset link. Please try again.'
    }
});

/** The wire shape of this endpoint's `409` body — see users-server's `conflict()`. */
type MemberConflictBody = {
    code?: string;
    retryAfterSeconds?: number;
};

/**
 * The Access tab's password card: an admin generates a single-use reset link
 * for an active member and hands it over.
 *
 * This is the whole "forgot my password" story today. There is no self-service
 * flow, because there is no mailer to send a link to (identity epic #11) — so
 * the recovery path runs through someone who can already be asked to vouch for
 * the person, which is a reasonable place for it to sit in the meantime.
 *
 * Only an `active` member qualifies: a `pending` one has no password yet (they
 * finish through the invite link) and a `disabled` one cannot sign in at all,
 * so a link for either is a link to nowhere. The server enforces both; the card
 * says so up front instead of letting the button fail.
 */
export function PasswordResetCard({ member }: { member: Member }) {
    const intl = useIntl();
    const canUpdate = useHasPermission('users:update');
    const issueReset = useIssuePasswordReset();

    // The minted link, held only until the dialog is dismissed. It is never
    // re-fetchable — the server keeps only its hash — so this state is the one
    // copy that exists.
    const [link, setLink] = useState<string | null>(null);

    const blockedReason =
        member.status === 'pending'
            ? messages.pending
            : member.status === 'disabled'
              ? messages.disabled
              : !canUpdate
                ? messages.noPermission
                : null;

    const generate = () => {
        issueReset.mutate(member.id, {
            onSuccess: (issued) => {
                // No token means the server emailed the link and kept the only
                // copy of it (ADR-0018 §4) — so there is nothing to put in the
                // hand-off dialog, and saying so beats opening an empty one.
                if (!issued.resetToken) {
                    toast.success(
                        intl.formatMessage(messages.mailed, {
                            email: member.email
                        })
                    );
                    return;
                }
                setLink(passwordResetLinkFor(issued.resetToken));
            },
            onError: (error) => {
                // A 409 is actionable and the body says how: the cooldown
                // carries the wait, so the admin is told to hold rather than
                // told "something conflicted" and left to guess.
                if (error.status === HTTP_STATUS.CONFLICT) {
                    const body = error.details as
                        | MemberConflictBody
                        | undefined;
                    toast.error(
                        body?.code === 'PASSWORD_RESET_RECENTLY_SENT'
                            ? intl.formatMessage(messages.recentlyIssued, {
                                  seconds: body.retryAfterSeconds ?? 60
                              })
                            : intl.formatMessage(messages.conflict)
                    );
                    return;
                }
                toast.error(intl.formatMessage(messages.failed));
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <KeyRound
                        aria-hidden
                        className="size-5 text-muted-foreground"
                    />
                    {intl.formatMessage(messages.title)}
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.body)}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {blockedReason ? (
                    <Alert>
                        <AlertDescription>
                            {intl.formatMessage(blockedReason)}
                        </AlertDescription>
                    </Alert>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.deliveryNote)}
                    </p>
                )}
                <Button
                    variant="outline"
                    onClick={generate}
                    disabled={blockedReason !== null || issueReset.isPending}
                >
                    {issueReset.isPending ? (
                        <>
                            <Spinner aria-hidden="true" />
                            <span className="sr-only">
                                {intl.formatMessage(messages.generating)}
                            </span>
                        </>
                    ) : (
                        intl.formatMessage(messages.generate)
                    )}
                </Button>
            </CardContent>

            <PasswordResetLinkDialog
                link={link}
                email={member.email}
                open={link !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setLink(null);
                    }
                }}
            />
        </Card>
    );
}
