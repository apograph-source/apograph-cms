/**
 * `@orthacms/webhooks-admin` — the global webhooks surface.
 *
 * Two pages in the sidebar's directory group: the endpoint list, and one
 * endpoint with its settings and its delivery log. Both are administrator-only,
 * because an endpoint is not scoped to a workspace and holds a signing secret.
 */

export {
    WebhooksPlugin,
    type WebhooksAdminPlugin
} from './lib/utils/webhooksPlugin';

export {
    useWebhookEndpoint,
    useWebhookEndpoints
} from './lib/application/useWebhookEndpoints';

export type {
    CreatedWebhookEndpoint,
    WebhookDelivery,
    WebhookDeliveryDetail,
    WebhookDeliveryPage,
    WebhookEndpoint,
    WebhookEventOption,
    WebhookLastDelivery,
    WebhookTestResult
} from './lib/domain/types/webhook';

export type {
    SaveWebhookInput,
    WebhookGateway
} from './lib/infrastructure/webhookGateway';
