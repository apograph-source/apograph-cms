import {
    Component,
    useEffect,
    useRef,
    type ErrorInfo,
    type ReactNode
} from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Logo
} from '@orthacms/design-system';

/** Intl descriptors for the fallback, co-located with it. */
const messages = defineMessages({
    title: {
        id: 'app.errorBoundary.title',
        defaultMessage: 'Something went wrong'
    },
    description: {
        id: 'app.errorBoundary.description',
        defaultMessage:
            'This page stopped working. Reloading usually fixes it — if it keeps happening, the last thing you did is worth reporting.'
    },
    reload: {
        id: 'app.errorBoundary.reload',
        defaultMessage: 'Reload the page'
    }
});

/**
 * The card shown when the routed tree throws.
 *
 * A function component because the boundary itself must be a class, and because
 * the copy has to go through the host's single `IntlProvider` like every other
 * string in the admin.
 *
 * It takes focus on mount. The failure replaces whatever the user was reading
 * with no navigation the browser would report, so without this focus stays on a
 * control that no longer exists and the browser resets it to `<body>`: a
 * keyboard user tabs from the top of a page nobody told them they had reached,
 * and a screen reader keeps reading a buffer of content that has been unmounted.
 * The heading carries `tabIndex={-1}` so it can receive focus without joining
 * the tab order.
 */
function AppCrashed() {
    const intl = useIntl();
    const headingRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    return (
        <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6">
            <Logo />
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle asChild>
                        <h1
                            ref={headingRef}
                            tabIndex={-1}
                            // Programmatic focus on a heading is `:focus-visible`
                            // in Chrome, which draws a box around the page title
                            // as if it were something to interact with. Safe to
                            // suppress only because `tabIndex={-1}` keeps it out
                            // of the tab order, so nobody can navigate onto it
                            // and need the indicator.
                            className="text-xl font-semibold outline-none"
                        >
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
                        // A failed lazy chunk is cached as failed by the module
                        // registry, and a render that threw on bad state will
                        // throw again — re-rendering cannot recover either, so
                        // only a fresh document request is offered.
                        onClick={() => window.location.reload()}
                    >
                        {intl.formatMessage(messages.reload)}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

/** Props for {@link AppErrorBoundary}. */
type AppErrorBoundaryProps = {
    /** The routed application tree being isolated. */
    children: ReactNode;
};

type AppErrorBoundaryState = { failed: boolean };

/**
 * The host's last line of defence: catches a render-phase throw from anywhere
 * in the routed tree.
 *
 * Without it a single misbehaving plugin takes the whole product with it. React
 * unmounts the entire tree when a throw reaches the root, so `#root` is left
 * with **zero children** — no sidebar to navigate away with, no message, nothing
 * to focus, and no hint that reloading is the fix. The two realistic causes are
 * a **lazy chunk that never arrives** (a deploy while the tab was open leaves
 * the browser asking for content-hashed files that no longer exist; `Suspense`
 * handles waiting, not failing, so it re-throws) and a page that reads an
 * unexpected shape out of an API response.
 *
 * Deliberately mounted **outside** `BrowserRouter` so a throw from the router
 * itself is caught too, and outside the `Toaster` so notifications survive the
 * failure. It is not a substitute for a narrower boundary: a plugin that can
 * usefully degrade one region should catch there (as `insights-admin` does
 * per-widget, and `identity-admin` does around the auth screens), because a
 * boundary this high can only offer a reload.
 *
 * A class component because React still offers no hook equivalent of
 * `componentDidCatch`, and a render-phase throw is exactly what needs catching.
 */
export class AppErrorBoundary extends Component<
    AppErrorBoundaryProps,
    AppErrorBoundaryState
> {
    override state: AppErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): AppErrorBoundaryState {
        return { failed: true };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error(
            '[bootstrap-admin] the application tree failed to render',
            error,
            info.componentStack
        );
    }

    override render(): ReactNode {
        if (!this.state.failed) return this.props.children;

        return <AppCrashed />;
    }
}
