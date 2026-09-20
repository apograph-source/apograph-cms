import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { describeWebhooksApi } from '../docs/describe-webhooks-api';
import { WebhooksModule } from '../webhooks.module';
import type { WebhooksPluginConfig } from '../types/webhooks-config';

/** The webhooks plugin, carrying its config alongside the standard shape. */
export interface WebhooksServerPluginType extends ServerPlugin {
    /** The configuration this plugin was constructed with. */
    webhooksConfig: WebhooksPluginConfig;
}

/**
 * Rejects a configuration that would misbehave rather than fail loudly.
 *
 * The bounds here are not style: a zero `batchSize` is a worker that claims
 * nothing and looks exactly like a worker with nothing to do, and a
 * `claimTimeoutMs` under the request timeout reclaims deliveries out from under
 * live requests and sends every slow one twice. Both are far cheaper to catch
 * at construction than to diagnose from a delivery log.
 */
function assertConfig(config: WebhooksPluginConfig): void {
    const positive: Array<[keyof WebhooksPluginConfig, number | undefined]> = [
        ['batchSize', config.batchSize],
        ['timeoutMs', config.timeoutMs],
        ['maxAttempts', config.maxAttempts],
        ['autoDisableAfter', config.autoDisableAfter],
        ['claimTimeoutMs', config.claimTimeoutMs],
        ['responseSnippetBytes', config.responseSnippetBytes]
    ];
    for (const [key, value] of positive) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
            throw new Error(
                `WebhooksPlugin: ${String(key)} must be a positive integer; got ${value}.`
            );
        }
    }

    // Zero is a real choice for both of these — "do not send from this process"
    // and "keep the log forever" — so only a negative value is refused.
    const nonNegative: Array<[keyof WebhooksPluginConfig, number | undefined]> =
        [
            ['deliveryIntervalMs', config.deliveryIntervalMs],
            ['retentionDays', config.retentionDays]
        ];
    for (const [key, value] of nonNegative) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
            throw new Error(
                `WebhooksPlugin: ${String(key)} must be a non-negative integer (0 disables it); got ${value}.`
            );
        }
    }

    const timeout = config.timeoutMs ?? 10_000;
    const claim = config.claimTimeoutMs ?? 30_000;
    if (claim <= timeout) {
        throw new Error(
            `WebhooksPlugin: claimTimeoutMs (${claim}) must exceed timeoutMs (${timeout}), ` +
                'or a delivery still in flight is reclaimed by another worker and sent twice.'
        );
    }
}

/**
 * Creates the webhooks plugin — outgoing HTTP notifications about content
 * changes.
 *
 * Register it **after** `DatabasePlugin` (the outbox it subscribes to and the
 * client it injects) and after `IdentityPlugin` (the permissions its routes are
 * gated on). It owns three tables — `webhook_endpoints`,
 * `webhook_endpoint_workspaces` and `webhook_deliveries` — and ships their
 * migrations under its own tracking table.
 *
 * It never delivers from inside the outbox subscriber: the subscriber queues
 * rows, and a worker sends them with no transaction open. See ADR-0016 for why
 * that separation is a rule rather than an implementation detail.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     ContentPlugin({ types: contentTypes }),
 *     WebhooksPlugin({ retentionDays: 30 })
 *   ]
 * });
 * ```
 */
export function WebhooksPlugin(
    config: WebhooksPluginConfig = {}
): WebhooksServerPluginType {
    assertConfig(config);
    return {
        name: 'webhooks',
        module: WebhooksModule.forRoot(config),
        webhooksConfig: config,
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_webhooks'
        },
        // Every response view here is an `interface`, which `@nestjs/swagger`
        // cannot see — so the scanner emits an empty 200 for each route. This
        // hook is where the reference learns what a delivery, an endpoint and
        // a test result actually look like.
        docs: { decorate: describeWebhooksApi }
    };
}
