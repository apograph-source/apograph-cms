import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Ban, MailCheck, ShieldCheck } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    toast
} from '@orthacms/design-system';
import { useAuth } from '@orthacms/identity-admin';
import { useSetMemberStatus } from '../../../application/useSetMemberStatus';
import { useUserDetailContext } from '../../userDetailContext';
import { MemberEntity } from '../../../domain/member';
import { ConfirmDialog } from '@orthacms/design-system';
import { PasswordResetCard } from '../../components/PasswordResetCard';

/** Intl descriptors for {@link UserAccessPage}, co-located with the component. */
const messages = defineMessages({
    title: { id: 'users.access.title', defaultMessage: 'Sign-in access' },
    activeTitle: {
        id: 'users.access.activeTitle',
        defaultMessage: 'This member can sign in'
    },
    activeBody: {
        id: 'users.access.activeBody',
        defaultMessage:
            'Suspending blocks sign-in and revokes active sessions. Their workspace memberships and authored content are kept, so reactivating restores access immediately.'
    },
    disabledTitle: {
        id: 'users.access.disabledTitle',
        defaultMessage: 'This member is suspended'
    },
    disabledBody: {
        id: 'users.access.disabledBody',
        defaultMessage:
            'They can’t sign in. Reactivate to restore access — memberships and content were preserved.'
    },
    pendingTitle: {
        id: 'users.access.pendingTitle',
        defaultMessage: 'Invite not accepted yet'
    },
    pendingBody: {
        id: 'users.access.pendingBody',
        defaultMessage:
            'This member hasn’t accepted their invite, so there’s no sign-in access to suspend yet.'
    },
    suspend: { id: 'users.access.suspend', defaultMessage: 'Suspend member' },
    reactivate: {
        id: 'users.access.reactivate',
        defaultMessage: 'Reactivate member'
    },
    confirmSuspendTitle: {
        id: 'users.access.confirmSuspendTitle',
        defaultMessage: 'Suspend {name}?'
    },
    confirmSuspendBody: {
        id: 'users.access.confirmSuspendBody',
        defaultMessage:
            'They’ll be signed out everywhere and blocked from signing in until reactivated.'
    },
    confirmReactivateTitle: {
        id: 'users.access.confirmReactivateTitle',
        defaultMessage: 'Reactivate {name}?'
    },
    confirmReactivateBody: {
        id: 'users.access.confirmReactivateBody',
        defaultMessage: 'They’ll be able to sign in again right away.'
    },
    lastAdmin: {
        id: 'users.access.lastAdmin',
        defaultMessage:
            'This member is the last remaining admin and can’t be suspended. Promote another member to admin first.'
    },
    self: {
        id: 'users.access.self',
        defaultMessage: 'You can’t suspend your own account.'
    },
    suspended: {
        id: 'users.access.suspended',
        defaultMessage: 'Suspended {name}.'
    },
    reactivated: {
        id: 'users.access.reactivated',
        defaultMessage: 'Reactivated {name}.'
    },
    failed: {
        id: 'users.access.failed',
        defaultMessage: 'Couldn’t update sign-in access. Please try again.'
    }
});

/**
 * The Access tab: everything that governs whether — and how — this member gets
 * into the product. Two cards:
 *
 * - **sign-in access** — suspend or reactivate. Mirrors the server's lifecycle:
 *   only `active` can be suspended, only `disabled` reactivated, and `pending`
 *   (un-accepted invite) is read-only. The last active admin and your own
 *   account can't be suspended; the button explains why instead of failing on
 *   submit.
 * - **password** — generate a single-use reset link for the member
 *   ({@link PasswordResetCard}).
 *
 * The two belong on one tab because they answer the same question from either
 * side: this is where an admin goes when someone can't get in, whether the
 * reason is that they were locked out or that they forgot their password.
 */
export function UserAccessPage() {
    const intl = useIntl();
    const { member } = useUserDetailContext();
    const auth = useAuth();
    const setStatus = useSetMemberStatus();
    const [confirming, setConfirming] = useState(false);

    const isDisabled = member.status === 'disabled';
    const isPending = member.status === 'pending';

    // Mirror the server's guardrails: you can't suspend yourself or the sole
    // admin. `lastAdmin` only blocks the suspend direction — reactivating a
    // disabled member is always allowed.
    const removal = MemberEntity.of(member).canBeRemoved(auth.user?.id);
    const blockedReason =
        !removal.ok && removal.reason === 'self'
            ? messages.self
            : !removal.ok && removal.reason === 'lastAdmin' && !isDisabled
              ? messages.lastAdmin
              : null;

    const card = isPending
        ? {
              icon: MailCheck,
              title: messages.pendingTitle,
              body: messages.pendingBody
          }
        : isDisabled
          ? {
                icon: Ban,
                title: messages.disabledTitle,
                body: messages.disabledBody
            }
          : {
                icon: ShieldCheck,
                title: messages.activeTitle,
                body: messages.activeBody
            };
    const Icon = card.icon;

    const run = () => {
        setStatus.mutate(
            { id: member.id, disabled: !isDisabled },
            {
                onSuccess: (updated) => {
                    setConfirming(false);
                    toast.success(
                        intl.formatMessage(
                            isDisabled
                                ? messages.reactivated
                                : messages.suspended,
                            { name: updated.name }
                        )
                    );
                },
                onError: () => {
                    setConfirming(false);
                    toast.error(intl.formatMessage(messages.failed));
                }
            }
        );
    };

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Icon
                            aria-hidden
                            className="size-5 text-muted-foreground"
                        />
                        {intl.formatMessage(card.title)}
                    </CardTitle>
                    <CardDescription>
                        {intl.formatMessage(card.body)}
                    </CardDescription>
                </CardHeader>
                {!isPending ? (
                    <CardContent className="space-y-3">
                        {blockedReason ? (
                            <Alert>
                                <AlertDescription>
                                    {intl.formatMessage(blockedReason)}
                                </AlertDescription>
                            </Alert>
                        ) : null}
                        <Button
                            variant={isDisabled ? 'default' : 'outline'}
                            onClick={() => setConfirming(true)}
                            disabled={
                                blockedReason !== null || setStatus.isPending
                            }
                        >
                            {intl.formatMessage(
                                isDisabled
                                    ? messages.reactivate
                                    : messages.suspend
                            )}
                        </Button>
                    </CardContent>
                ) : null}

                <ConfirmDialog
                    open={confirming}
                    onOpenChange={setConfirming}
                    busy={setStatus.isPending}
                    title={intl.formatMessage(
                        isDisabled
                            ? messages.confirmReactivateTitle
                            : messages.confirmSuspendTitle,
                        { name: member.name }
                    )}
                    description={intl.formatMessage(
                        isDisabled
                            ? messages.confirmReactivateBody
                            : messages.confirmSuspendBody
                    )}
                    confirmLabel={intl.formatMessage(
                        isDisabled ? messages.reactivate : messages.suspend
                    )}
                    confirmVariant={isDisabled ? 'default' : 'destructive'}
                    onConfirm={run}
                />
            </Card>

            <PasswordResetCard member={member} />
        </div>
    );
}
