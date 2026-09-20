import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { Webhook } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useDocumentTitle } from '@orthacms/utils-admin';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    Spinner,
    toast
} from '@orthacms/design-system';
import { useWebhookEndpoint } from '../../../application/useWebhookEndpoints';
import { useWebhookEvents } from '../../../application/useWebhookEvents';
import { useWorkspaceOptions } from '../../../application/useWorkspaceOptions';
import { useContentTypeOptions } from '../../../application/useContentTypeOptions';
import {
    useCreateWebhook,
    useUpdateWebhook
} from '../../../application/useWebhookMutations';
import { serverMessageOf } from '../../../infrastructure/serverMessageOf';
import { WebhookForm } from '../../components/WebhookForm';
import { RevealWebhookSecretDialog } from '../../components/RevealWebhookSecretDialog';
import { WebhooksNoAccess } from '../../components/WebhooksNoAccess';

const messages = defineMessages({
    listTitle: { id: 'webhooks.page.title', defaultMessage: 'Webhooks' },
    createTitle: {
        id: 'webhooks.editor.createTitle',
        defaultMessage: 'New webhook'
    },
    editTitle: {
        id: 'webhooks.editor.editTitle',
        defaultMessage: 'Edit webhook'
    },
    subtitle: {
        id: 'webhooks.editor.subtitle',
        defaultMessage:
            'Choose where deliveries go and which changes are worth sending.'
    },
    created: { id: 'webhooks.page.created', defaultMessage: 'Webhook created' },
    saved: { id: 'webhooks.detail.saved', defaultMessage: 'Webhook updated' },
    createFailed: {
        id: 'webhooks.page.createFailed',
        defaultMessage: 'Couldn’t create the webhook. Please try again.'
    },
    saveFailed: {
        id: 'webhooks.detail.saveFailed',
        defaultMessage: 'Couldn’t save the webhook. Please try again.'
    },
    notFound: {
        id: 'webhooks.detail.notFound',
        defaultMessage: 'That webhook no longer exists.'
    },
    back: { id: 'webhooks.detail.back', defaultMessage: 'Back to webhooks' }
});

/** Props for {@link WebhookEditorPage}. */
export type WebhookEditorPageProps = {
    /**
     * `'create'` mounts a blank form; `'edit'` (the default) loads the endpoint
     * named by the route.
     *
     * One component for both, as in the alarms rule editor: the two forms are
     * the same form. The only differences are what seeds it and where saving
     * goes afterwards, and a second page would duplicate the whole subscription
     * surface for that.
     */
    mode?: 'create' | 'edit';
};

/**
 * Creates or edits one endpoint, as a page rather than a dialog.
 *
 * The form asks eight questions across three filters, two of which are pickers
 * that open their own popovers; inside a modal that meant a scrolling box with
 * popovers portalled into it to survive the scroll lock. On a page the two
 * halves — where deliveries go, and what is worth sending — sit side by side,
 * and the browser's own back button is the way out.
 *
 * Creating ends on the one-time secret: it exists nowhere else from that moment
 * on, so the reveal opens here and only then does the page move to the new
 * endpoint.
 */
export function WebhookEditorPage({
    mode = 'edit'
}: WebhookEditorPageProps = {}) {
    const intl = useIntl();
    const navigate = useNavigate();
    const { id = '' } = useParams<{ id: string }>();
    const isCreate = mode === 'create';

    const canRead = useHasPermission('webhooks:read');
    const canManage = useHasPermission('webhooks:manage');

    const [formError, setFormError] = useState<string | null>(null);
    const [created, setCreated] = useState<{
        id: string;
        secret: string;
    } | null>(null);

    const {
        data: endpoint,
        isPending,
        isError
    } = useWebhookEndpoint(id, canRead && !isCreate && id.length > 0);
    // The pickers are the page now, so unlike the dialog they load with it.
    const { data: events } = useWebhookEvents(canManage);
    const { data: workspaces } = useWorkspaceOptions(canManage);
    const { data: contentTypes } = useContentTypeOptions(canManage);

    const create = useCreateWebhook();
    const update = useUpdateWebhook();

    const title = intl.formatMessage(
        isCreate ? messages.createTitle : messages.editTitle
    );
    useDocumentTitle(title);

    const crumbs = [
        {
            key: 'webhooks',
            label: intl.formatMessage(messages.listTitle),
            to: '/webhooks'
        },
        ...(isCreate
            ? []
            : [
                  {
                      key: 'endpoint',
                      label: endpoint?.name ?? title,
                      to: `/webhooks/${id}`
                  }
              ]),
        { key: 'editor', label: title }
    ];

    // `webhooks:manage` and not merely `webhooks:read`: this page only exists
    // to write. Reaching it by URL without the key gets the same answer the nav
    // gives, rather than a form whose Save would be refused.
    if (!canRead || !canManage) {
        return (
            <>
                <PageTopBar icon={Webhook} crumbs={crumbs} />
                <Container>
                    <ContainerHeader title={title} />
                    <WebhooksNoAccess />
                </Container>
            </>
        );
    }

    if (!isCreate && isPending) {
        return (
            <Container>
                <div className="flex justify-center py-16">
                    <Spinner />
                </div>
            </Container>
        );
    }

    if (!isCreate && (isError || !endpoint)) {
        return (
            <>
                <PageTopBar icon={Webhook} crumbs={crumbs} />
                <Container>
                    <Alert variant="destructive" role="alert" className="mt-8">
                        <AlertDescription className="flex items-center justify-between gap-4">
                            {intl.formatMessage(messages.notFound)}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate('/webhooks')}
                            >
                                {intl.formatMessage(messages.back)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                </Container>
            </>
        );
    }

    const leave = () =>
        navigate(isCreate ? '/webhooks' : `/webhooks/${id}`, { replace: true });

    return (
        <>
            <PageTopBar icon={Webhook} crumbs={crumbs} />
            <Container>
                <ContainerHeader
                    title={title}
                    subtitle={intl.formatMessage(messages.subtitle)}
                />

                <div className="mt-6">
                    <WebhookForm
                        endpoint={isCreate ? undefined : endpoint}
                        events={events ?? []}
                        workspaces={workspaces ?? []}
                        contentTypes={contentTypes ?? []}
                        pending={create.isPending || update.isPending}
                        error={formError}
                        onCancel={leave}
                        onSubmit={(input) => {
                            setFormError(null);
                            // A refused URL comes back with a message written
                            // for whoever typed it; show that rather than a
                            // generic failure, and stay on the form so it can
                            // be corrected in place.
                            const onError = (error: unknown) =>
                                setFormError(
                                    serverMessageOf(error) ??
                                        intl.formatMessage(
                                            isCreate
                                                ? messages.createFailed
                                                : messages.saveFailed
                                        )
                                );

                            if (isCreate) {
                                create.mutate(input, {
                                    onSuccess: ({ endpoint: made, secret }) => {
                                        toast.success(
                                            intl.formatMessage(messages.created)
                                        );
                                        // The secret exists nowhere else from
                                        // here on, so the page waits on the
                                        // reveal rather than navigating past
                                        // it.
                                        setCreated({ id: made.id, secret });
                                    },
                                    onError
                                });
                                return;
                            }

                            update.mutate(
                                { id, input },
                                {
                                    onSuccess: () => {
                                        toast.success(
                                            intl.formatMessage(messages.saved)
                                        );
                                        navigate(`/webhooks/${id}`, {
                                            replace: true
                                        });
                                    },
                                    onError
                                }
                            );
                        }}
                    />
                </div>
            </Container>

            <RevealWebhookSecretDialog
                secret={created?.secret ?? null}
                open={created !== null}
                onOpenChange={(next) => {
                    if (next || !created) return;
                    navigate(`/webhooks/${created.id}`, { replace: true });
                    setCreated(null);
                }}
            />
        </>
    );
}
