import { defineMessages, useIntl } from 'react-intl';
import { MonitorSmartphone } from 'lucide-react';
import {
    Badge,
    Button,
    Card,
    CardContent,
    Spinner
} from '@orthacms/design-system';
import type { UserSession } from '../../../application/useUserSessions';

/** Intl descriptors for {@link SessionCard}. */
const messages = defineMessages({
    unknownDevice: {
        id: 'users.sessions.unknownDevice',
        defaultMessage: 'Unknown device'
    },
    current: {
        id: 'users.sessions.current',
        defaultMessage: 'This session'
    },
    lastSeen: {
        id: 'users.sessions.lastSeen',
        defaultMessage: 'Last seen {when}'
    },
    revoke: { id: 'users.sessions.revoke', defaultMessage: 'Revoke' },
    revokeLabel: {
        id: 'users.sessions.revokeLabel',
        defaultMessage: 'Revoke the session on {device}, last seen {when}'
    }
});

/**
 * One of a member's live sessions: device/user-agent, originating IP, when it
 * was last seen, and a Revoke action. The caller's own session is badged and
 * its Revoke button disabled, so an admin can't sign themselves out from here.
 */
export function SessionCard({
    session,
    busy = false,
    onRevoke
}: {
    /** The session to render. */
    session: UserSession;
    /** Whether a revoke for this session is in flight. */
    busy?: boolean;
    /** Revoke handler. */
    onRevoke: (session: UserSession) => void;
}) {
    const intl = useIntl();
    const device =
        session.userAgent?.trim() || intl.formatMessage(messages.unknownDevice);
    const lastSeen = intl.formatDate(session.lastSeenAt, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });

    return (
        <Card>
            <CardContent className="flex items-center gap-3 pt-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <MonitorSmartphone aria-hidden className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                            {device}
                        </p>
                        {session.current ? (
                            <Badge
                                variant="secondary"
                                className="shrink-0 whitespace-nowrap rounded-xl border-border"
                            >
                                {intl.formatMessage(messages.current)}
                            </Badge>
                        ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                        {session.ipAddress ? `${session.ipAddress} · ` : ''}
                        {intl.formatMessage(messages.lastSeen, {
                            when: lastSeen
                        })}
                    </p>
                </div>
                {/* The visible word is just "Revoke" on every card, so the
                    accessible name has to carry the device — otherwise a screen
                    reader hears the same label on all of them and cannot tell
                    which one it is about to sign out (WCAG 2.4.6 / 4.1.2). */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={busy || session.current}
                    aria-label={intl.formatMessage(messages.revokeLabel, {
                        device,
                        when: lastSeen
                    })}
                    onClick={() => onRevoke(session)}
                >
                    {busy ? <Spinner /> : null}
                    {intl.formatMessage(messages.revoke)}
                </Button>
            </CardContent>
        </Card>
    );
}
