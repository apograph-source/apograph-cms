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

/** Intl descriptors for {@link ResetLinkUnavailable}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.resetPassword.unavailable.title',
        defaultMessage: 'This reset link no longer works'
    },
    description: {
        id: 'identity.resetPassword.unavailable.description',
        defaultMessage:
            'Reset links are single-use and expire after a while, so this one has most likely already been used, been replaced by a newer link, or simply timed out.'
    },
    whatToDo: {
        id: 'identity.resetPassword.unavailable.whatToDo',
        defaultMessage:
            'Ask an administrator for a fresh one. If you already set a new password, sign in with it instead — the link is not needed after that.'
    },
    missingToken: {
        id: 'identity.resetPassword.unavailable.missingToken',
        defaultMessage:
            'This address is missing its reset code, so there is nothing to reset. Open the link exactly as you received it — some chat apps cut long links in half.'
    },
    signIn: {
        id: 'identity.resetPassword.unavailable.signIn',
        defaultMessage: 'Go to sign in'
    }
});

/** Props for {@link ResetLinkUnavailable}. */
type ResetLinkUnavailableProps = {
    /**
     * Whether the URL carried no token at all, as opposed to one the server
     * rejected. The two are different mistakes and deserve different advice —
     * a truncated link is fixable by the person holding it, a dead one is not.
     */
    missingToken?: boolean;
};

/**
 * The dead-end state of the reset screen: the link is missing its token, or the
 * server would not honour it. The server deliberately does not say *why* a
 * token failed (unknown, expired, already used, and "the account is no longer
 * active" are one generic 404, so the endpoint can't be used to probe for live
 * links or existing accounts), so this explains the likely causes and gives the
 * one action that always helps — asking for a fresh link.
 */
export function ResetLinkUnavailable({
    missingToken = false
}: ResetLinkUnavailableProps) {
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
