import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Pencil, Send, Trash2, TriangleAlert, Webhook } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useDocumentTitle } from '@orthacms/utils-admin';
import {
    Alert,
    AlertDescription,
    Button,
    ConfirmDialog,
    Container,
    ContainerHeader,
    Spinner,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    toast
} from '@orthacms/design-system';
import { useWebhookEndpoint } from '../../../application/useWebhookEndpoints';
import {
    useDeleteWebhook,
    useRotateWebhookSecret,
    useTestWebhook
} from '../../../application/useWebhookMutations';
import { RevealWebhookSecretDialog } from '../../components/RevealWebhookSecretDialog';
import { WebhookDeliveriesPanel } from '../../components/WebhookDeliveriesPanel';
import { WebhooksNoAccess } from '../../components/WebhooksNoAccess';

const messages = defineMessages({
    listTitle: { id: 'webhooks.page.title', defaultMessage: 'Webhooks' },
    settings: {
        id: 'webhooks.detail.settings',
        defaultMessage: 'Settings'
    },
    deliveries: {
        id: 'webhooks.detail.deliveries',
        defaultMessage: 'Deliveries'
    },
    edit: { id: 'webhooks.detail.edit', defaultMessage: 'Edit' },
    test: { id: 'webhooks.detail.test', defaultMessage: 'Send test' },
    rotate: {
        id: 'webhooks.detail.rotate',
        defaultMessage: 'Rotate secret'
    },
    remove: { id: 'webhooks.detail.remove', defaultMessage: 'Delete' },
    url: { id: 'webhooks.detail.url', defaultMessage: 'URL' },
    secret: { id: 'webhooks.detail.secret', defaultMessage: 'Signing secret' },
    headers: {
        id: 'webhooks.detail.headers',
        defaultMessage: 'Custom headers'
    },
    noHeaders: {
        id: 'webhooks.detail.noHeaders',
        defaultMessage: 'None'
    },
    secretValue: {
        id: 'webhooks.detail.secretValue',
        defaultMessage: 'Ends in {hint}'
    },
    events: { id: 'webhooks.detail.events', defaultMessage: 'Events' },
    allEvents: {
        id: 'webhooks.detail.allEvents',
        defaultMessage: 'All events'
    },
    workspaces: {
        id: 'webhooks.detail.workspaces',
        defaultMessage: 'Workspaces'
    },
    allWorkspaces: {
        id: 'webhooks.detail.allWorkspaces',
        defaultMessage: 'All workspaces'
    },
    contentTypes: {
        id: 'webhooks.detail.contentTypes',
        defaultMessage: 'Content types'
    },
    allContentTypes: {
        id: 'webhooks.detail.allContentTypes',
        defaultMessage: 'All content types'
    },
    state: { id: 'webhooks.detail.state', defaultMessage: 'State' },
    active: { id: 'webhooks.detail.active', defaultMessage: 'Active' },
    paused: { id: 'webhooks.detail.paused', defaultMessage: 'Paused' },
    notFound: {
        id: 'webhooks.detail.notFound',
        defaultMessage: 'That webhook no longer exists.'
    },
    back: { id: 'webhooks.detail.back', defaultMessage: 'Back to webhooks' },
    deleted: {
        id: 'webhooks.detail.deleted',
        defaultMessage: 'Webhook deleted'
    },
    deleteFailed: {
        id: 'webhooks.detail.deleteFailed',
        defaultMessage: 'Couldn’t delete the webhook. Please try again.'
    },
    confirmDeleteTitle: {
        id: 'webhooks.detail.confirmDeleteTitle',
        defaultMessage: 'Delete this webhook?'
    },
    confirmDeleteBody: {
        id: 'webhooks.detail.confirmDeleteBody',
        defaultMessage:
            'Deliveries stop immediately and the delivery log goes with it. This cannot be undone.'
    },
    confirmDelete: {
        id: 'webhooks.detail.confirmDelete',
        defaultMessage: 'Delete webhook'
    },
    cancel: { id: 'webhooks.detail.cancel', defaultMessage: 'Cancel' },
    testOk: {
        id: 'webhooks.detail.testOk',
        defaultMessage: 'Receiver answered {status} in {ms} ms'
    },
    testFailed: {
        id: 'webhooks.detail.testFailed',
        defaultMessage: 'Test delivery failed: {reason}'
    },
    autoDisabled: {
        id: 'webhooks.detail.autoDisabled',
        defaultMessage:
            '{reason} Fix the receiver, then switch the webhook back on from Edit.'
    }
});

/** One labelled fact in the settings summary. */
function Fact({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{children}</dd>
        </div>
    );
}

/**
 * One endpoint: its configuration, and its delivery log.
 *
 * The two tabs answer the two questions someone comes here with — "what does
 * this send?" and "did it arrive?" — and the second is where almost all the
 * time is spent, which is why the log polls itself rather than waiting to be
 * refreshed.
 */
export function WebhookDetailPage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const { id = '' } = useParams<{ id: string }>();

    const canRead = useHasPermission('webhooks:read');
    const canManage = useHasPermission('webhooks:manage');

    const [secret, setSecret] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const {
        data: endpoint,
        isPending,
        isError
    } = useWebhookEndpoint(id, canRead && id.length > 0);
    const remove = useDeleteWebhook();
    const rotate = useRotateWebhookSecret();
    const test = useTestWebhook();

    useDocumentTitle(endpoint?.name ?? intl.formatMessage(messages.listTitle));

    if (!canRead) {
        return (
            <Container>
                <WebhooksNoAccess />
            </Container>
        );
    }

    if (isPending) {
        return (
            <Container>
                <div className="flex justify-center py-16">
                    <Spinner />
                </div>
            </Container>
        );
    }

    if (isError || !endpoint) {
        return (
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
        );
    }

    return (
        <>
            <PageTopBar
                icon={Webhook}
                crumbs={[
                    {
                        key: 'webhooks',
                        label: intl.formatMessage(messages.listTitle),
                        to: '/webhooks'
                    },
                    { key: endpoint.id, label: endpoint.name }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={endpoint.name}
                    subtitle={endpoint.url}
                    actions={
                        canManage ? (
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    disabled={test.isPending}
                                    onClick={() =>
                                        test.mutate(endpoint.id, {
                                            onSuccess: (result) => {
                                                if (result.ok) {
                                                    toast.success(
                                                        intl.formatMessage(
                                                            messages.testOk,
                                                            {
                                                                status: result.statusCode,
                                                                ms: result.durationMs
                                                            }
                                                        )
                                                    );
                                                } else {
                                                    toast.error(
                                                        intl.formatMessage(
                                                            messages.testFailed,
                                                            {
                                                                reason:
                                                                    result.error ??
                                                                    `HTTP ${result.statusCode}`
                                                            }
                                                        )
                                                    );
                                                }
                                            }
                                        })
                                    }
                                >
                                    <Send aria-hidden />
                                    {intl.formatMessage(messages.test)}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        navigate(
                                            `/webhooks/${endpoint.id}/edit`
                                        )
                                    }
                                >
                                    <Pencil aria-hidden />
                                    {intl.formatMessage(messages.edit)}
                                </Button>
                            </div>
                        ) : undefined
                    }
                />

                {endpoint.disabledReason ? (
                    <Alert variant="destructive" role="alert" className="mt-4">
                        <TriangleAlert aria-hidden />
                        <AlertDescription>
                            {intl.formatMessage(messages.autoDisabled, {
                                reason: endpoint.disabledReason
                            })}
                        </AlertDescription>
                    </Alert>
                ) : null}

                <Tabs defaultValue="deliveries" className="mt-6">
                    <TabsList>
                        <TabsTrigger value="deliveries">
                            {intl.formatMessage(messages.deliveries)}
                        </TabsTrigger>
                        <TabsTrigger value="settings">
                            {intl.formatMessage(messages.settings)}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="deliveries" className="mt-4">
                        <WebhookDeliveriesPanel
                            endpointId={endpoint.id}
                            canRedeliver={canManage}
                        />
                    </TabsContent>

                    <TabsContent value="settings" className="mt-4">
                        <dl className="grid gap-4 sm:grid-cols-2">
                            <Fact label={intl.formatMessage(messages.url)}>
                                <span className="font-mono text-xs break-all">
                                    {endpoint.url}
                                </span>
                            </Fact>
                            <Fact label={intl.formatMessage(messages.state)}>
                                {intl.formatMessage(
                                    endpoint.enabled
                                        ? messages.active
                                        : messages.paused
                                )}
                            </Fact>
                            <Fact label={intl.formatMessage(messages.events)}>
                                {endpoint.eventKinds.length === 0
                                    ? intl.formatMessage(messages.allEvents)
                                    : endpoint.eventKinds.join(', ')}
                            </Fact>
                            <Fact
                                label={intl.formatMessage(
                                    messages.contentTypes
                                )}
                            >
                                {endpoint.contentTypes.length === 0
                                    ? intl.formatMessage(
                                          messages.allContentTypes
                                      )
                                    : endpoint.contentTypes.join(', ')}
                            </Fact>
                            <Fact
                                label={intl.formatMessage(messages.workspaces)}
                            >
                                {endpoint.allWorkspaces
                                    ? intl.formatMessage(messages.allWorkspaces)
                                    : endpoint.workspaceIds.length}
                            </Fact>
                            <Fact label={intl.formatMessage(messages.headers)}>
                                {/* Names only. The values are credentials for
                                    somebody else's system; the editor is where
                                    they are read and changed. */}
                                <span className="font-mono text-xs break-all">
                                    {Object.keys(endpoint.headers).length === 0
                                        ? intl.formatMessage(messages.noHeaders)
                                        : Object.keys(endpoint.headers).join(
                                              ', '
                                          )}
                                </span>
                            </Fact>
                            <Fact label={intl.formatMessage(messages.secret)}>
                                {/* Only the hint: the secret is shown once, on
                                    mint and on rotation, and never again. */}
                                <span className="font-mono text-xs">
                                    {intl.formatMessage(messages.secretValue, {
                                        hint: endpoint.secretHint
                                    })}
                                </span>
                            </Fact>
                        </dl>

                        {canManage ? (
                            <div className="mt-8 flex flex-wrap gap-2 border-t pt-4">
                                <Button
                                    variant="outline"
                                    disabled={rotate.isPending}
                                    onClick={() =>
                                        rotate.mutate(endpoint.id, {
                                            onSuccess: ({ secret: minted }) =>
                                                setSecret(minted)
                                        })
                                    }
                                >
                                    {intl.formatMessage(messages.rotate)}
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => setConfirmDelete(true)}
                                >
                                    <Trash2 aria-hidden />
                                    {intl.formatMessage(messages.remove)}
                                </Button>
                            </div>
                        ) : null}
                    </TabsContent>
                </Tabs>
            </Container>

            <RevealWebhookSecretDialog
                secret={secret}
                rotated
                open={secret !== null}
                onOpenChange={(next) => {
                    if (!next) setSecret(null);
                }}
            />

            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={intl.formatMessage(messages.confirmDeleteTitle)}
                description={intl.formatMessage(messages.confirmDeleteBody)}
                confirmLabel={intl.formatMessage(messages.confirmDelete)}
                cancelLabel={intl.formatMessage(messages.cancel)}
                confirmVariant="destructive"
                busy={remove.isPending}
                onConfirm={() =>
                    remove.mutate(endpoint.id, {
                        onSuccess: () => {
                            toast.success(intl.formatMessage(messages.deleted));
                            navigate('/webhooks');
                        },
                        onError: () =>
                            toast.error(
                                intl.formatMessage(messages.deleteFailed)
                            )
                    })
                }
            />
        </>
    );
}
