import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { defineMessages, useIntl } from 'react-intl';
import {
    Card,
    CardContent,
    CardHeader,
    Skeleton
} from '@orthacms/design-system';
import { HTTP_STATUS, useDocumentTitle } from '@orthacms/utils-admin';
import { AuthLayout } from '../../components/AuthLayout';
import { InviteUnavailable } from '../../components/InviteUnavailable';
import { InviteLookupFailed } from '../../components/InviteLookupFailed';
import {
    AcceptInviteForm,
    type AcceptInviteFormValues
} from '../../components/AcceptInviteForm';
import { useInvite } from '../../../application/useInvite';
import { useAcceptInviteMutation } from '../../../application/useAcceptInviteMutation';
import { currentUserKey } from '../../../application/useCurrentUser';
import { rateLimitMessage } from '../../rateLimitMessage';

/** Intl descriptors for {@link AcceptInvitePage}, co-located with the component. */
const messages = defineMessages({
    documentTitle: {
        id: 'identity.acceptInvite.documentTitle',
        defaultMessage: 'Accept your invite'
    },
    loading: {
        id: 'identity.acceptInvite.loading',
        defaultMessage: 'Checking your invite…'
    },
    loadingHeading: {
        id: 'identity.acceptInvite.loadingHeading',
        defaultMessage: 'Accept your invitation'
    },
    linkExpired: {
        id: 'identity.acceptInvite.error.linkExpired',
        defaultMessage:
            'This invite was accepted or expired while you were filling the form. Ask for a new one and try again.'
    },
    rejected: {
        id: 'identity.acceptInvite.error.rejected',
        defaultMessage:
            'That password didn’t meet our requirements. Pick a longer one and try again.'
    },
    generic: {
        id: 'identity.acceptInvite.error.generic',
        defaultMessage: 'Something went wrong. Please try again.'
    }
});

/**
 * Accept-invite page — the route container the identity router mounts at
 * `/identity/accept-invite?token=…`. It reads the token from the query string,
 * resolves it to who the invite is for, and lets that person set their first
 * password.
 *
 * On success the server has already activated the account and set the session
 * cookie, so this refreshes the current user (flipping the host's auth context
 * to authenticated) and drops the invitee straight into the app — no second trip
 * through the login form.
 *
 * The token lives in the query string rather than the path so it never lands in
 * a route pattern, and the page never puts it in a link or a redirect target.
 */
export function AcceptInvitePage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const invite = useInvite(token);
    const { mutate, isPending, error } = useAcceptInviteMutation();

    useDocumentTitle(intl.formatMessage(messages.documentTitle));

    const handleSubmit = (values: AcceptInviteFormValues) => {
        mutate(
            { token, ...values },
            {
                onSuccess: async () => {
                    await queryClient.invalidateQueries({
                        queryKey: currentUserKey
                    });
                    navigate('/', { replace: true });
                }
            }
        );
    };

    if (!token) {
        return (
            <AuthLayout surface="invite-missing-token">
                <InviteUnavailable missingToken />
            </AuthLayout>
        );
    }

    if (invite.isPending) {
        return (
            <AuthLayout surface="invite-loading" focusHeading={false}>
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
    // the invitee is offered a retry instead of a replacement invite.
    if (invite.isError && invite.error?.status !== HTTP_STATUS.NOT_FOUND) {
        return (
            <AuthLayout surface="invite-lookup-failed">
                <InviteLookupFailed
                    onRetry={() => void invite.refetch()}
                    isRetrying={invite.isFetching}
                />
            </AuthLayout>
        );
    }

    if (invite.isError || !invite.data) {
        return (
            <AuthLayout surface="invite-dead-link">
                <InviteUnavailable />
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
        <AuthLayout surface="invite-form">
            <AcceptInviteForm
                token={token}
                invite={invite.data}
                onSubmit={handleSubmit}
                isPending={isPending}
                error={errorMessage}
            />
        </AuthLayout>
    );
}
