import { defineMessages, useIntl } from 'react-intl';
import { useDocumentTitle } from '@orthacms/utils-admin';
import { AuthLayout } from '../../components/AuthLayout';
import { AuthRouteUnavailable } from '../../components/AuthRouteUnavailable';

/** Intl descriptors for {@link RouteNotFoundPage}, co-located with the page. */
const messages = defineMessages({
    documentTitle: {
        id: 'identity.route.documentTitle',
        defaultMessage: 'Link not found'
    }
});

/**
 * The `/identity/*` catch-all: an address in this plugin's subtree that names
 * no screen.
 *
 * It is a page rather than a bare `<Navigate>` because arriving here almost
 * always means a link was cut short on its way to the visitor, and a silent
 * redirect to the sign-in form would leave them typing a password they may not
 * have instead of going back for the whole link. It names itself in the tab
 * title for the same reason every other auth screen does — a visitor with
 * several tabs open should be able to tell which one went wrong.
 */
export function RouteNotFoundPage() {
    const intl = useIntl();

    useDocumentTitle(intl.formatMessage(messages.documentTitle));

    return (
        <AuthLayout surface="route-not-found">
            <AuthRouteUnavailable />
        </AuthLayout>
    );
}
