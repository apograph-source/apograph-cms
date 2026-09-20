import { defineMessages, useIntl } from 'react-intl';
import {
    Card,
    CardContent,
    CardHeader,
    Skeleton
} from '@orthacms/design-system';
import { AuthLayout } from '../AuthLayout';

/** Intl descriptors for {@link LoginSkeleton}, co-located with the component. */
const messages = defineMessages({
    loading: {
        id: 'identity.login.skeleton.loading',
        defaultMessage: 'Loading…'
    },
    heading: {
        id: 'identity.login.skeleton.heading',
        defaultMessage: 'Sign in'
    }
});

/**
 * Lazy-route `Suspense` fallback for the sign-in page. Reuses {@link AuthLayout}
 * (the same muted, centered column with the brand mark) and sketches the login
 * card — title, two fields, submit button — so the chunk load doesn't flash an
 * empty centered spinner. A single `role="status"` region announces the busy
 * state; the card is `aria-hidden`.
 */
export function LoginSkeleton() {
    const intl = useIntl();

    return (
        <AuthLayout surface="chunk-loading" focusHeading={false}>
            {/* The page's `<h1>`, visually hidden. The loaded page gets one from
                `LoginForm`'s `CardTitle`, but the chunk-loading state rendered
                none — and a loading state is the state a slow connection sits in
                longest, so it is the one most likely to be navigated by heading
                (`ORT-167`). It is not focused: `AuthLayout` deliberately skips
                the focus move for a skeleton that is about to be replaced. */}
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <div role="status">
                <span className="sr-only">
                    {intl.formatMessage(messages.loading)}
                </span>
                <Card aria-hidden>
                    <CardHeader className="gap-2">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-56 max-w-full" />
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                            <Skeleton className="h-9 w-full" />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AuthLayout>
    );
}
