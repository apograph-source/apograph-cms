import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy
} from '@nestjs/common';
import {
    classifyStatus,
    isExhausted,
    nextAttemptDelayMs,
    type DeliveryVerdict
} from '@orthacms/webhooks-domain';
import { InjectWebhooksConfig } from '../webhooks.tokens';
import type { ResolvedWebhooksConfig } from '../types/webhooks-config';
import {
    WebhookDeliveryRepository,
    type AttemptOutcome,
    type ClaimedDelivery
} from './webhook-delivery.repository';
import { WebhookEndpointRepository } from './webhook-endpoint.repository';
import { WebhookHttpClient } from './webhook-http.client';

/**
 * Sends queued deliveries.
 *
 * **The one structural rule:** the claim runs in a transaction, the POST does
 * not. `WebhookDeliveryRepository.claim` opens a short transaction, marks a
 * batch `delivering` and commits; only then does this worker touch the network.
 * A receiver that takes the full timeout therefore costs one row's progress,
 * not a held pool client and not the outbox.
 *
 * **Why a plain interval and not a scheduler.** `OutboxDispatcher`'s poll
 * backstop and the alarms sweep set the precedent: one timer in-process, with
 * the work behind it made safe to run concurrently. `FOR UPDATE SKIP LOCKED`
 * means several API processes running this take disjoint rows, so scaling out
 * simply sends faster.
 *
 * Deliveries in one batch run **serially**. Twenty parallel requests would be a
 * burst aimed at whichever receivers happen to be subscribed, and the whole
 * point of the retry schedule's jitter is not to do that.
 */
@Injectable()
export class WebhookDeliveryWorker
    implements OnApplicationBootstrap, OnModuleDestroy
{
    private readonly logger = new Logger(WebhookDeliveryWorker.name);
    private timer: ReturnType<typeof setInterval> | null = null;
    /** The tick in flight, so shutdown can wait for it. */
    private running: Promise<void> | null = null;
    private stopped = false;
    /** When the retention sweep last ran, so it is not run every tick. */
    private lastPrunedAt = 0;

    constructor(
        private readonly deliveries: WebhookDeliveryRepository,
        private readonly endpoints: WebhookEndpointRepository,
        private readonly http: WebhookHttpClient,
        @InjectWebhooksConfig()
        private readonly config: ResolvedWebhooksConfig
    ) {}

    /** Arms the interval, unless delivery is switched off. */
    onApplicationBootstrap(): void {
        const interval = this.config.deliveryIntervalMs;
        if (interval <= 0) {
            this.logger.log(
                'Webhook delivery is disabled (deliveryIntervalMs is 0); events will queue but nothing will be sent from this process.'
            );
            return;
        }
        this.timer = setInterval(() => void this.tick(), interval);
        // Never hold the process open for a background sender.
        this.timer.unref?.();
    }

    /**
     * Stops the timer and waits for the tick in flight.
     *
     * Waiting matters: a tick abandoned mid-batch leaves rows in `delivering`
     * that only the claim's stale-row recovery will free, so the deliveries it
     * had already sent would be retried after the timeout for no reason.
     */
    async onModuleDestroy(): Promise<void> {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.running) await this.running;
    }

    /** One guarded tick — skips if the previous one is still going. */
    private async tick(): Promise<void> {
        if (this.running || this.stopped) return;
        this.running = this.runOnce().finally(() => {
            this.running = null;
        });
        await this.running;
    }

    /**
     * Claims one batch, sends each delivery, then prunes if it is time.
     *
     * Public because "send what is claimable now" is a real operation and not
     * only the timer's business: a deployment that runs the sender out of
     * process, and the e2e suites, both need to drive a batch on demand rather
     * than waiting for an interval to come round.
     */
    async runOnce(): Promise<void> {
        try {
            const claimed = await this.deliveries.claim(
                this.config.batchSize,
                this.config.claimTimeoutMs
            );

            for (const delivery of claimed) {
                if (this.stopped) break;
                await this.deliver(delivery);
            }

            await this.pruneIfDue();
        } catch (error) {
            // A failing tick must never kill the interval; the next one retries
            // from whatever state the database is in.
            this.logger.error(
                'A webhook delivery tick failed',
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /** Sends one delivery and records what happened. */
    private async deliver(delivery: ClaimedDelivery): Promise<void> {
        const endpoint = await this.endpoints.findForDelivery(
            delivery.endpointId
        );

        if (!endpoint) {
            // The endpoint was deleted between the claim and now. The row is on
            // its way out by cascade; closing it keeps it from being re-claimed
            // in the meantime.
            await this.deliveries.markDead(delivery.id, {
                statusCode: null,
                error: 'The endpoint was deleted before this delivery was sent.',
                responseSnippet: null,
                durationMs: 0
            });
            return;
        }

        if (!endpoint.enabled) {
            // Switched off — by hand or automatically — after this row was
            // queued. Sending anyway would defeat the switch.
            await this.deliveries.markDead(delivery.id, {
                statusCode: null,
                error: 'The endpoint was disabled before this delivery was sent.',
                responseSnippet: null,
                durationMs: 0
            });
            return;
        }

        const attempt = delivery.attempts + 1;
        const response = await this.http.send({
            url: endpoint.url,
            secret: endpoint.secret,
            headers: endpoint.headers,
            body: delivery.payload,
            eventKind: delivery.eventKind,
            deliveryId: delivery.id,
            eventId: delivery.eventId,
            workspaceId: delivery.workspaceId,
            attempt
        });

        const outcome: AttemptOutcome = {
            statusCode: response.statusCode,
            error: response.error,
            responseSnippet: response.responseSnippet,
            durationMs: response.durationMs
        };

        // No status at all — a timeout, a refused connection, a rejected
        // address — is a transport failure, which is retryable in the same way
        // a 5xx is.
        const verdict: DeliveryVerdict =
            response.statusCode === null
                ? { outcome: 'retry' }
                : classifyStatus(response.statusCode, response.retryAfterMs);

        if (verdict.outcome === 'succeeded') {
            await this.deliveries.markSucceeded(delivery.id, outcome);
            await this.endpoints.recordSuccess(endpoint.id);
            return;
        }

        if (
            verdict.outcome === 'dead' ||
            isExhausted(attempt, this.config.maxAttempts)
        ) {
            await this.deliveries.markDead(delivery.id, {
                ...outcome,
                error:
                    verdict.outcome === 'dead'
                        ? verdict.reason
                        : (outcome.error ??
                          `Gave up after ${attempt} attempts.`)
            });
            await this.penalise(endpoint.id, endpoint.name);
            return;
        }

        const delayMs = verdict.retryAfterMs ?? nextAttemptDelayMs(attempt);
        await this.deliveries.markRetrying(
            delivery.id,
            outcome,
            new Date(Date.now() + delayMs)
        );
    }

    /** Counts a dead delivery against the endpoint, disabling it at the cap. */
    private async penalise(
        endpointId: string,
        endpointName: string
    ): Promise<void> {
        const disabled = await this.endpoints.recordFailure(
            endpointId,
            this.config.autoDisableAfter
        );
        if (disabled) {
            this.logger.warn(
                `Webhook endpoint "${endpointName}" (${endpointId}) was disabled after ` +
                    `${this.config.autoDisableAfter} consecutive failed deliveries.`
            );
        }
    }

    /**
     * Deletes completed deliveries past the retention window, at most once an
     * hour.
     *
     * The log is the only table here that nothing else prunes; without this it
     * grows for the life of the deployment at the rate content is edited.
     */
    private async pruneIfDue(): Promise<void> {
        const retentionDays = this.config.retentionDays;
        if (retentionDays <= 0) return;

        const hour = 60 * 60_000;
        if (Date.now() - this.lastPrunedAt < hour) return;
        this.lastPrunedAt = Date.now();

        const cutoff = new Date(Date.now() - retentionDays * 24 * hour);
        const removed = await this.deliveries.pruneCompletedBefore(cutoff);
        if (removed > 0) {
            this.logger.log(
                `Pruned ${removed} webhook deliveries older than ${retentionDays} days.`
            );
        }
    }
}
