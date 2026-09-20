import { defineMessages, useIntl } from 'react-intl';
import { Button, Field, FieldSeparator } from '@orthacms/design-system';
import { useSsoProviders } from '../../../application/useSsoProviders';

/** Intl descriptors for {@link SsoProviders}, co-located with the component. */
const messages = defineMessages({
    separator: {
        id: 'identity.login.sso.separator',
        defaultMessage: 'or continue with'
    },
    signInWith: {
        id: 'identity.login.sso.signInWith',
        defaultMessage: 'Sign in with {provider}'
    },
    continueWith: {
        id: 'identity.login.sso.continueWith',
        defaultMessage: 'Continue with {provider}'
    }
});

/** Props for {@link SsoProviders}. */
type SsoProvidersProps = {
    /**
     * Where to land after signing in — the location the gate was aiming at.
     * Carried through the handshake in the attempt row, and validated
     * server-side as a same-origin path, so a value from the router's state
     * cannot become an off-site redirect.
     */
    redirectTo?: string;
    /**
     * The raw invite token, when this is the accept-invitation screen rather
     * than the sign-in one. It turns the handshake into invite acceptance: the
     * server redeems the invite and activates the account with **no password**,
     * so the identity provider becomes the only way in — which is what the
     * person chose by using this button.
     *
     * The server checks that the address the provider vouches for is the one
     * that was invited, so this cannot be used to claim someone else's
     * invitation.
     */
    inviteToken?: string;
    /** The separator's text, which differs between the two screens. */
    separatorLabel?: string;
};

/**
 * The "or continue with" block: one button per registered identity provider.
 *
 * **These are links, not buttons with click handlers.** Signing in through a
 * provider is a full-page navigation to `/api/auth/sso/:name/start`, which
 * answers `302`. An anchor is what a navigation is, so middle-click and
 * open-in-new-tab behave, and no JavaScript stands between the person and the
 * redirect. They are styled as buttons because that is what they are *for*;
 * `Button asChild` is the design system's own way to say so.
 *
 * **It renders nothing at all** when the deployment registers no providers,
 * when the list is still loading, or when the request failed. The password form
 * is the sign-in page; this is an addition to it. Showing a spinner would make
 * every visitor wait on a feature most deployments do not use, and showing an
 * error would hand someone a problem they cannot act on while they are trying
 * to sign in a way that still works.
 */
export function SsoProviders({
    redirectTo,
    inviteToken,
    separatorLabel
}: SsoProvidersProps) {
    const intl = useIntl();
    const { data: providers } = useSsoProviders();

    if (!providers || providers.length === 0) {
        return null;
    }

    return (
        <>
            <FieldSeparator>
                {separatorLabel ?? intl.formatMessage(messages.separator)}
            </FieldSeparator>
            <Field className="gap-3">
                {providers.map((provider) => (
                    <Button
                        key={provider.name}
                        asChild
                        variant="outline"
                        className="w-full"
                    >
                        <a
                            href={startUrl(
                                provider.name,
                                redirectTo,
                                inviteToken
                            )}
                        >
                            {intl.formatMessage(
                                inviteToken
                                    ? messages.continueWith
                                    : messages.signInWith,
                                { provider: provider.label }
                            )}
                        </a>
                    </Button>
                ))}
            </Field>
        </>
    );
}

/**
 * The sign-in URL for one provider.
 *
 * Same-origin and absolute-from-root, so it works under the dev proxy
 * (`/api` → the API) and in a deployment serving both from one host — the same
 * assumption `apiClient` already makes. The provider name is encoded because it
 * is a path segment, even though the server refuses to register a name that
 * would need encoding; belt and braces cost nothing here, and the guard lives
 * in a different package.
 */
function startUrl(
    name: string,
    redirectTo?: string,
    inviteToken?: string
): string {
    const url = new URLSearchParams();
    if (redirectTo && redirectTo !== '/') {
        url.set('redirect', redirectTo);
    }
    if (inviteToken) {
        url.set('invite', inviteToken);
    }
    const query = url.toString();
    const path = `/api/auth/sso/${encodeURIComponent(name)}/start`;
    return query ? `${path}?${query}` : path;
}
