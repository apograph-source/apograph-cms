import { useSearchParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Card,
    CardContent,
    CardHeader,
    Skeleton
} from '@orthacms/design-system';
import { HTTP_STATUS, useDocumentTitle } from '@orthacms/utils-admin';
import { AuthLayout } from '../../components/AuthLayout';
import { ResetLinkUnavailable } from '../../components/ResetLinkUnavailable';
import { ResetLinkLookupFailed } from '../../components/ResetLinkLookupFailed';
import { PasswordResetDone } from '../../components/PasswordResetDone';
import {
    ResetPasswordForm,
    type ResetPasswordFormValues
} from '../../components/ResetPasswordForm';
import { usePasswordReset } from '../../../application/usePasswordReset';
import { useResetPasswordMutation } from '../../../application/useResetPasswordMutation';
import { rateLimitMessage } from '../../rateLimitMessage';

/** Intl descriptors for {@link ResetPasswordPage}, co-located with the component. */
const messages = defineMessages({
    documentTitle: {
        id: 'identity.resetPassword.documentTitle',
        defaultMessage: 'Reset your password'
    },
    loading: {
        id: 'identity.resetPassword.loading',
        defaultMessage: 'Checking your reset link…'
    },
    loadingHeading: {
        id: 'identity.resetPassword.loadingHeading',
        defaultMessage: 'Reset your password'
    },
    linkExpired: {
        id: 'identity.resetPassword.error.linkExpired',
        defaultMessage:
            'This link was used or expired while you were filling the form. Ask an administrator for a new one and try again.'
    },
    rejected: {
        id: 'identity.resetPassword.error.rejected',
        defaultMessage:
            'That password didn’t meet our requirements. Pick a longer one and try again.'
    },
    generic: {
        id: 'identity.resetPassword.error.generic',
        defaultMessage: 'Something went wrong. Please try again.'
    }
});

/**
 * Reset-password page — the route container the identity router mounts at
 * `/identity/reset-password?token=…`, the far end of the link an admin
 * generates from a member's Access tab. It reads the token from the query
 * string, resolves it to the account it belongs to, and lets that person set a
 * new password.
 *
 * On success it does **not** navigate into the app: the redemption revokes every
 * session and issues none, so the page hands off to the sign-in form
 * ({@link PasswordResetDone}) rather than pretending the user is now
 * authenticated.
 *
 * The token lives in the query string rather than the path so it never lands in
 * a route pattern, and the page never puts it in a link or a redirect target.
 */
export function ResetPasswordPage() {
    const intl = useIntl();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const reset = usePasswordReset(token);
    const { mutate, isPending, isSuccess, error } = useResetPasswordMutation();

    useDocumentTitle(intl.formatMessage(messages.documentTitle));

    const handleSubmit = (values: ResetPasswordFormValues) => {
        mutate({ token, ...values });
    };

    if (!token) {
        return (
            <AuthLayout surface="reset-missing-token">
                <ResetLinkUnavailable missingToken />
            </AuthLayout>
        );
    }

    // Checked before the lookup states below: once the password is set the token
    // is spent, so a refetch of the link would report it dead and replace the
    // confirmation with a "this link no longer works" card — technically true,
    // and exactly the wrong thing to tell someone who just succeeded.
    if (isSuccess) {
        return (
            <AuthLayout surface="reset-done">
                <PasswordResetDone />
            </AuthLayout>
        );
    }

    if (reset.isPending) {
        return (
            <AuthLayout surface="reset-loading" focusHeading={false}>
                {/* The busy state's `<h1>`, visually hidden: it is a
                    full page like any other and was reporting none
                    (`ORT-167`). */}
                <h1 className="sr-only">
                    {intl.formatMessage(messages.loadingHeading)}
                </h1>
                <div role="status">
                    <span className="sr-only">
                        {intl.formatMessage(messages.loading)}
                    </span>
                    <Card aria-hidden>
                        <CardHeader className="gap-2">
                            <Skeleton className="h-6 w-44" />
                            <Skeleton className="h-4 w-60 max-w-full" />
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-6">
                                <div className="flex flex-col gap-2">
                                    <Skeleton className="h-4 w-16" />
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

    // A `404` is the one answer that means the link itself is finished: the
    // server returns it for unknown, expired and already-used alike, and so
    // does this page. Anything else — a `500`, a timeout, a dropped connection —
    // says nothing about the token, so it must not be reported as a dead link;
    // the user is offered a retry instead of a replacement they'd have to ask
    // for (and which would kill the link they are holding).
    if (reset.isError && reset.error?.status !== HTTP_STATUS.NOT_FOUND) {
        return (
            <AuthLayout surface="reset-lookup-failed">
                <ResetLinkLookupFailed
                    onRetry={() => void reset.refetch()}
                    isRetrying={reset.isFetching}
                />
            </AuthLayout>
        );
    }

    if (reset.isError || !reset.data) {
        return (
            <AuthLayout surface="reset-dead-link">
                <ResetLinkUnavailable />
            </AuthLayout>
        );
    }

    const errorMessage = error
        ? // Before the generic branch: this route carries `ThrottlerGuard` too,
          // and a 429 is a temporary answer, not a broken request.
          (rateLimitMessage(intl, error) ??
          intl.formatMessage(
              error.status === HTTP_STATUS.NOT_FOUND
                  ? messages.linkExpired
                  : error.status === HTTP_STATUS.BAD_REQUEST
                    ? messages.rejected
                    : messages.generic
          ))
        : undefined;

    return (
        <AuthLayout surface="reset-form">
            <ResetPasswordForm
                reset={reset.data}
                onSubmit={handleSubmit}
                isPending={isPending}
                error={errorMessage}
            />
        </AuthLayout>
    );
}
