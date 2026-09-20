/**
 * `@orthacms/webhooks-server` — outgoing webhooks on content changes.
 *
 * Subscribes to the transactional outbox, queues one delivery row per
 * subscribed endpoint, and sends them from a worker that holds no transaction
 * while it waits on someone else's server. Owns three tables and ships their
 * migrations; the rules about what a delivery *means* live in
 * `@orthacms/webhooks-domain`.
 */

export {
    WebhooksPlugin,
    type WebhooksServerPluginType
} from './lib/utils/webhooks-plugin';

export { WebhooksModule } from './lib/webhooks.module';

export {
    WEBHOOKS_DEFAULTS,
    resolveWebhooksConfig,
    type ResolvedWebhooksConfig,
    type WebhooksPluginConfig
} from './lib/types/webhooks-config';

export { InjectWebhooksConfig, WEBHOOKS_CONFIG } from './lib/webhooks.tokens';

export {
    WebhookEndpointsService,
    type WebhookEndpointWithSecret
} from './lib/application/webhook-endpoints.service';

export { WebhookDeliveryWorker } from './lib/infrastructure/webhook-delivery.worker';

export {
    WebhookDeliveryNotFoundError,
    WebhookEndpointNotFoundError
} from './lib/domain/errors';

export type {
    WebhookDeliveryDetailView,
    WebhookDeliveryPage,
    WebhookDeliveryView,
    WebhookEndpointView,
    WebhookLastDeliveryView,
    WebhookTestResult
} from './lib/domain/webhook-views';

export {
    webhookDeliveries,
    webhookEndpointWorkspaces,
    webhookEndpoints
} from './lib/infrastructure/schema';
