import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link InviteUnavailable}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.acceptInvite.unavailable.title',
        defaultMessage: 'This invite link no longer works'
    },
    description: {
        id: 'identity.acceptInvite.unavailable.description',
        defaultMessage:
            'Invite links are single-use and expire after a while, so this one has most likely already been accepted, been replaced by a newer invite, or simply timed out.'
    },
    whatToDo: {
        id: 'identity.acceptInvite.unavailable.whatToDo',
        defaultMessage:
            'Ask whoever invited you to send a fresh one. If you have already set your password, sign in instead — the link is not needed after that.'
    },
    missingToken: {
        id: 'identity.acceptInvite.unavailable.missingToken',
        defaultMessage:
            'This address is missing its invite code, so there is nothing to accept. Open the link from your invite exactly as you received it — some chat apps cut long links in half.'
    },
    signIn: {
        id: 'identity.acceptInvite.unavailable.signIn',
        defaultMessage: 'Go to sign in'
    }
});

/** Props for {@link InviteUnavailable}. */
type InviteUnavailableProps = {
    /**
     * Whether the URL carried no token at all, as opposed to one the server
     * rejected. The two are different mistakes and deserve different advice —
     * a truncated link is fixable by the invitee, a dead one is not.
     */
    missingToken?: boolean;
};

/**
 * The dead-end state of the accept-invite screen: the link is missing its
 * token, or the server would not honour it. The server deliberately does not
 * say *why* a token failed (unknown, expired, and already-used are one generic
 * 404, so the endpoint can't be used to probe for live invites), so this
 * explains the likely causes and gives the one action that always helps —
 * asking for a fresh invite.
 */
export function InviteUnavailable({
    missingToken = false
}: InviteUnavailableProps) {
    const intl = useIntl();

    return (
        <Card>
            <CardHeader className="text-center">
                <CardTitle asChild className="text-xl">
                    <h1>{intl.formatMessage(messages.title)}</h1>
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(
                        missingToken
                            ? messages.missingToken
                            : messages.description
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                    {intl.formatMessage(messages.whatToDo)}
                </p>
                <Button asChild variant="outline" className="w-full">
                    <Link to="/identity/signin">
                        {intl.formatMessage(messages.signIn)}
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}
