import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Skeleton,
    toast
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    useUserSessions,
    type UserSession
} from '../../../application/useUserSessions';
import { useRevokeSession } from '../../../application/useRevokeSession';
import { useUserDetailContext } from '../../userDetailContext';
import { ConfirmDialog } from '@orthacms/design-system';
import { SessionCard } from '../../components/SessionCard';

/** Intl descriptors for {@link UserSessionsPage}. */
const messages = defineMessages({
    title: { id: 'users.sessions.title', defaultMessage: 'Sessions' },
    description: {
        id: 'users.sessions.description',
        defaultMessage: 'Devices currently signed in as this member.'
    },
    empty: {
        id: 'users.sessions.empty',
        defaultMessage: 'No active sessions.'
    },
    error: {
        id: 'users.sessions.error',
        defaultMessage: 'Couldn’t load sessions. Please try again.'
    },
    retry: { id: 'users.sessions.retry', defaultMessage: 'Retry' },
    confirmTitle: {
        id: 'users.sessions.confirmTitle',
        defaultMessage: 'Revoke the session on {device}?'
    },
    confirmBody: {
        id: 'users.sessions.confirmBody',
        defaultMessage:
            'Last seen {when}{ip}. That device will be signed out immediately and must sign in again.'
    },
    confirmBodyIp: {
        id: 'users.sessions.confirmBodyIp',
        defaultMessage: ' from {ip}'
    },
    unknownDevice: {
        id: 'users.sessions.confirmUnknownDevice',
        defaultMessage: 'an unknown device'
    },
    confirmRevoke: {
        id: 'users.sessions.confirmRevoke',
        defaultMessage: 'Revoke'
    },
    revoked: {
        id: 'users.sessions.revoked',
        defaultMessage: 'Session revoked.'
    },
    failed: {
        id: 'users.sessions.failed',
        defaultMessage: 'Couldn’t revoke the session. Please try again.'
    }
});

/**
 * The Sessions tab: a member's live sessions with a per-device Revoke. Gated on
 * `users:update` (the rail hides it otherwise); revoking is confirmed and drops
 * the row on success. The viewer's own session can't be revoked from here.
 */
export function UserSessionsPage() {
    const intl = useIntl();
    const { member } = useUserDetailContext();
    const canManage = useHasPermission('users:update');
    const {
        data: sessions,
        isPending,
        isError,
        refetch
    } = useUserSessions(member.id, canManage);
    const revoke = useRevokeSession();
    const [revoking, setRevoking] = useState<UserSession | null>(null);
    const headingRef = useRef<HTMLDivElement>(null);

    /**
     * The revoked card unmounts, so Radix has no trigger to hand focus back to
     * and it falls to `<body>` (WCAG 2.4.3). Send it to the section heading
     * instead — a stable anchor that also re-announces where the user is.
     */
    const restoreFocus = () => {
        requestAnimationFrame(() => {
            headingRef.current?.focus();
        });
    };

    const onRevoke = () => {
        if (!revoking) {
            return;
        }
        revoke.mutate(
            { userId: member.id, sessionId: revoking.id },
            {
                onSuccess: () => {
                    toast.success(intl.formatMessage(messages.revoked));
                    setRevoking(null);
                    restoreFocus();
                },
                onError: () => {
                    toast.error(intl.formatMessage(messages.failed));
                    setRevoking(null);
                    restoreFocus();
                }
            }
        );
    };

    return (
        <Card>
            <CardHeader ref={headingRef} tabIndex={-1} className="outline-none">
                <CardTitle>{intl.formatMessage(messages.title)}</CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {isPending ? (
                    <>
                        <Skeleton className="h-16 w-full rounded-xl" />
                        <Skeleton className="h-16 w-full rounded-xl" />
                    </>
                ) : isError ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>{intl.formatMessage(messages.error)}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refetch()}
                            >
                                {intl.formatMessage(messages.retry)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : sessions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    sessions.map((session) => (
                        <SessionCard
                            key={session.id}
                            session={session}
                            busy={
                                revoke.isPending && revoking?.id === session.id
                            }
                            onRevoke={setRevoking}
                        />
                    ))
                )}
            </CardContent>

            <ConfirmDialog
                open={revoking !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRevoking(null);
                        restoreFocus();
                    }
                }}
                busy={revoke.isPending}
                // Name the device: the dialog is the last thing shown before an
                // irreversible sign-out, and on a member with several sessions
                // an unnamed one is indistinguishable from the others.
                title={intl.formatMessage(messages.confirmTitle, {
                    device:
                        revoking?.userAgent?.trim() ||
                        intl.formatMessage(messages.unknownDevice)
                })}
                description={intl.formatMessage(messages.confirmBody, {
                    when: revoking
                        ? intl.formatDate(revoking.lastSeenAt, {
                              dateStyle: 'medium',
                              timeStyle: 'short'
                          })
                        : '',
                    ip: revoking?.ipAddress
                        ? intl.formatMessage(messages.confirmBodyIp, {
                              ip: revoking.ipAddress
                          })
                        : ''
                })}
                confirmLabel={intl.formatMessage(messages.confirmRevoke)}
                confirmVariant="destructive"
                onConfirm={onRevoke}
            />
        </Card>
    );
}
