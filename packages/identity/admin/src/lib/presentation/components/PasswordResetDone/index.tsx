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

/** Intl descriptors for {@link PasswordResetDone}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.resetPassword.done.title',
        defaultMessage: 'Your password is set'
    },
    description: {
        id: 'identity.resetPassword.done.description',
        defaultMessage:
            'Sign in with your new password. The reset link has been used up and won’t work again.'
    },
    signedOutNote: {
        id: 'identity.resetPassword.done.signedOutNote',
        defaultMessage:
            'Every device that was signed in to this account has been signed out. If you did not ask for this reset, tell an administrator — someone else requested the link.'
    },
    signIn: {
        id: 'identity.resetPassword.done.signIn',
        defaultMessage: 'Go to sign in'
    }
});

/**
 * The reset screen's success state. The redemption deliberately issues no
 * session — the person proved only that they hold a link — so this is a
 * hand-off to the sign-in form rather than a redirect into the app, and it says
 * so plainly instead of leaving someone wondering why they are not already in.
 *
 * It also names the consequence they did not choose: every session on the
 * account was revoked. Someone whose account was reset *without* asking needs
 * to hear that from the product, at the moment it happens, not discover it as
 * a mystery sign-out later.
 */
export function PasswordResetDone() {
    const intl = useIntl();

    return (
        <Card>
            <CardHeader className="text-center">
                <CardTitle asChild className="text-xl">
                    <h1>{intl.formatMessage(messages.title)}</h1>
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                    {intl.formatMessage(messages.signedOutNote)}
                </p>
                <Button asChild className="w-full">
                    <Link to="/identity/signin">
                        {intl.formatMessage(messages.signIn)}
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}
