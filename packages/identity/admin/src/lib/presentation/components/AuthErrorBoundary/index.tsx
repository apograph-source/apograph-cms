import { Component, type ErrorInfo, type ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@orthacms/design-system';
import { AuthLayout } from '../AuthLayout';

/** Intl descriptors for the boundary's fallback, co-located with it. */
const messages = defineMessages({
    title: {
        id: 'identity.authBoundary.title',
        defaultMessage: 'This page didn’t finish loading'
    },
    description: {
        id: 'identity.authBoundary.description',
        defaultMessage:
            'Part of the app failed to load. This usually means it was updated while your tab was open, and reloading picks up the new version.'
    },
    reload: {
        id: 'identity.authBoundary.reload',
        defaultMessage: 'Reload the page'
    }
});

/**
 * The card shown when an auth screen fails to render. Split out as a function
 * component because the boundary itself must be a class, and the copy has to go
 * through `react-intl` like every other string in this package.
 */
function AuthScreenFailed() {
    const intl = useIntl();

    return (
        <AuthLayout surface="auth-boundary">
            <Card>
                <CardHeader className="text-center">
                    <CardTitle asChild>
                        <h1 className="text-xl font-semibold">
                            {intl.formatMessage(messages.title)}
                        </h1>
                    </CardTitle>
                    <CardDescription>
                        {intl.formatMessage(messages.description)}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                        type="button"
                        className="w-full"
                        // A failed chunk is cached as failed by the router, so
                        // re-rendering cannot recover it — only a fresh document
                        // request will fetch the new build's assets.
                        onClick={() => window.location.reload()}
                    >
                        {intl.formatMessage(messages.reload)}
                    </Button>
                </CardContent>
            </Card>
        </AuthLayout>
    );
}

/** Props for {@link AuthErrorBoundary}. */
type AuthErrorBoundaryProps = {
    /** The lazily-loaded auth routes being isolated. */
    children: ReactNode;
};

type AuthErrorBoundaryState = { failed: boolean };

/**
 * Catches a render-phase throw from the lazily-loaded auth screens.
 *
 * The failure this exists for is a **deploy during an open tab**: the browser
 * still holds the old `index.html`, whose chunk filenames are content-hashed and
 * no longer on the server, so the dynamic `import()` behind `/identity/signin`
 * rejects. React propagates that past the `Suspense` fallback — a boundary is
 * the only thing that stops it — and with nothing to catch it the whole app
 * unmounted to a blank white page. On the sign-in route specifically that is as
 * bad as it gets: the user cannot get in, and a blank page offers no hint that
 * reloading is the fix.
 *
 * Deliberately a class component: React still offers no hook equivalent of
 * `componentDidCatch`, and a render-phase throw is exactly what needs catching.
 */
export class AuthErrorBoundary extends Component<
    AuthErrorBoundaryProps,
    AuthErrorBoundaryState
> {
    override state: AuthErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): AuthErrorBoundaryState {
        return { failed: true };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error(
            '[identity] an auth screen failed to render',
            error,
            info.componentStack
        );
    }

    override render(): ReactNode {
        if (!this.state.failed) return this.props.children;

        return <AuthScreenFailed />;
    }
}
