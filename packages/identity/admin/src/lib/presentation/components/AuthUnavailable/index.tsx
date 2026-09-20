import { useQueryClient } from '@tanstack/react-query';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@orthacms/design-system';
import { currentUserKey } from '../../../application/useCurrentUser';
import { AuthLayout } from '../AuthLayout';

/** Intl descriptors for {@link AuthUnavailable}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.authUnavailable.title',
        defaultMessage: 'We can’t reach the server'
    },
    description: {
        id: 'identity.authUnavailable.description',
        defaultMessage:
            'Your session is fine — we just couldn’t confirm who you are, because the API didn’t answer.'
    },
    whatToDo: {
        id: 'identity.authUnavailable.whatToDo',
        defaultMessage:
            'Try again in a moment. If it keeps happening, ask an administrator to check on the server — signing in again will not help.'
    },
    retry: {
        id: 'identity.authUnavailable.retry',
        defaultMessage: 'Try again'
    }
});

/**
 * The gate's *outage* screen: the current-user probe failed for a reason other
 * than `401`, so whether anyone is signed in is simply unknown.
 *
 * It exists so that state has somewhere to go other than the sign-in page.
 * Bouncing to sign-in tells the user a falsehood ("you are signed out") and
 * points them at the one action that cannot work — the login request goes to
 * the same API that is down, so they are left staring at a generic credential
 * error with a valid session in their cookie jar.
 */
export function AuthUnavailable() {
    const intl = useIntl();
    const queryClient = useQueryClient();

    return (
        <AuthLayout surface="auth-unavailable">
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
                        {intl.formatMessage(messages.whatToDo)}
                    </p>
                    <Button
                        type="button"
                        className="w-full"
                        // Refetch through the client rather than mounting a
                        // second `useCurrentUser` observer here: a fresh
                        // observer on a failed query refetches on mount, and
                        // since a retry swaps this screen for the root loader
                        // and back, that would spin the probe in a loop.
                        onClick={() =>
                            void queryClient.refetchQueries({
                                queryKey: currentUserKey
                            })
                        }
                    >
                        {intl.formatMessage(messages.retry)}
                    </Button>
                </CardContent>
            </Card>
        </AuthLayout>
    );
}
