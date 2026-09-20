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

/**
 * Intl descriptors for {@link AuthRouteUnavailable}, co-located with the
 * component.
 */
const messages = defineMessages({
    title: {
        id: 'identity.route.unavailable.title',
        defaultMessage: 'This link doesn’t go anywhere'
    },
    description: {
        id: 'identity.route.unavailable.description',
        defaultMessage:
            'There is no page at this address. The most likely cause is a link that arrived incomplete — some chat and mail clients cut long links in half, and an invite or reset link is long.'
    },
    whatToDo: {
        id: 'identity.route.unavailable.whatToDo',
        defaultMessage:
            'Open the link from your message again, in full. If it keeps landing here, ask an administrator for a fresh one — or sign in, if you already have a password.'
    },
    signIn: {
        id: 'identity.route.unavailable.signIn',
        defaultMessage: 'Go to sign in'
    }
});

/**
 * The catch-all for an address under `/identity/*` that names no screen.
 *
 * Without it these paths rendered **nothing** — no heading, no text, a blank
 * document — because the plugin's nested router claims the whole `/identity/*`
 * subtree, so the host's own catch-all never sees them.
 *
 * A blank page is the worst answer here specifically, and for a reason the
 * sibling screens already take seriously. Everything under `/identity` is
 * reached from a link in someone's inbox rather than by navigating the app, and
 * `InviteUnavailable` already carries copy about chat clients cutting long
 * links in half. That truncation does not always land on a valid screen with a
 * missing token — cut a little earlier and the *path* is what breaks, which is
 * exactly this route. The invitee then got a white screen from the one flow
 * that had been written to explain itself.
 *
 * Hence a card rather than a silent redirect to the sign-in form: the visitor
 * arrived by link, not by navigation, and needs to be told the link is the
 * problem so they know to go back for a whole one.
 */
export function AuthRouteUnavailable() {
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
