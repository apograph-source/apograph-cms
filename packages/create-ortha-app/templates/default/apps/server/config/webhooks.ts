import type { WebhooksPluginConfig } from '@orthacms/webhooks-server';
import { readFlag, readPositiveInt } from '@orthacms/utils-server';

/**
 * Outgoing webhooks — how hard the sender pushes, and where it may reach.
 *
 * Endpoints themselves live in the database; an administrator adds them on the
 * admin's Webhooks page. Only the five values a deployment genuinely varies are
 * env-sourced, and the rest are left to the plugin's own defaults, where the
 * reasoning behind them is written down.
 *
 * The two `allow*` flags are the ones worth reading twice. Both default to
 * **off**, and both widen what a URL an operator types can reach:
 * `WEBHOOKS_ALLOW_INSECURE_URLS` permits plain HTTP, and
 * `WEBHOOKS_ALLOW_PRIVATE_NETWORKS` permits loopback and RFC 1918 — which a
 * self-hosted install with an in-cluster receiver genuinely needs, and an
 * internet-facing one must not have. A webhook is this server making a request
 * to an address a user typed, which is the shape of every SSRF.
 */
export function webhooksConfig(): WebhooksPluginConfig {
    return {
        // 0 turns the sender off in this process. Rows still queue, so a
        // deployment can run web nodes that only enqueue and one that sends.
        deliveryIntervalMs: readPositiveInt(
            'WEBHOOKS_DELIVERY_INTERVAL',
            2_000
        ),
        timeoutMs: readPositiveInt('WEBHOOKS_TIMEOUT', 10_000),
        // Nothing else prunes the delivery log.
        retentionDays: readPositiveInt('WEBHOOKS_RETENTION_DAYS', 30),
        allowInsecureUrls: readFlag('WEBHOOKS_ALLOW_INSECURE_URLS', false),
        allowPrivateNetworks: readFlag('WEBHOOKS_ALLOW_PRIVATE_NETWORKS', false)
    };
}
