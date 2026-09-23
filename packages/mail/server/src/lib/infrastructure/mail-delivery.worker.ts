import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy
} from '@nestjs/common';
import {
    MAIL_PROVIDER,
    MailPermanentError,
    isExhausted,
    nextAttemptDelayMs,
    type MailProvider
} from '@orthacms/mail-domain';
import { Inject } from '@nestjs/common';
import { InjectMailConfig } from '../mail.tokens';
import type { ResolvedMailConfig } from '../types/mail-config';
import {
    MailDeliveryRepository,
    type ClaimedMail
} from './mail-delivery.repository';

/**
 * Hands queued messages to the provider.
 *
 * **The one structural rule:** the claim runs in a transaction, the hand-off
 * does not. `MailDeliveryRepository.claim` opens a short transaction, leases a
 * batch and commits; only then does this worker talk to a mail server. A relay
 * that takes the full timeout therefore costs one message's progress, not a
 * held pool client — the rule ADR-0016 exists for, which this plugin keeps even
 * though its enqueue deliberately breaks that record's *shape*.
 *
 * Messages in one batch are handed over **serially**. Twenty parallel
 * connections to one relay is the behaviour that gets a sender rate-limited,
 * and the retry schedule's jitter exists precisely so a backlog does not come
 * back as a burst.
 */
@Injectable()
export class MailDeliveryWorker
    implements OnApplicationBootstrap, OnModuleDestroy
{
    private readonly logger = new Logger(MailDeliveryWorker.name);
    private timer: ReturnType<typeof setInterval> | null = null;
    /** The tick in flight, so shutdown can wait for it. */
    private running: Promise<void> | null = null;
    private stopped = false;
    /** When the expiry sweep last ran, so it is not run every tick. */
    private lastSweptAt = 0;

    constructor(
        private readonly deliveries: MailDeliveryRepository,
        @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
        @InjectMailConfig() private readonly config: ResolvedMailConfig
    ) {}

    /** Arms the interval, unless sending is switched off in this process. */
    onApplicationBootstrap(): void {
        const interval = this.config.deliveryIntervalMs;
        if (interval <= 0) {
            this.logger.log(
                'Mail delivery is disabled in this process (deliveryIntervalMs is 0); messages will ' +
                    'queue but nothing will be sent from here.'
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
     * Waiting matters: a tick abandoned mid-batch leaves leased rows that only
     * lapse on the claim timeout, so messages it had already handed over would
     * be sent a second time when the lease expired.
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
     * Claims one batch, hands each message over, then sweeps if it is time.
     *
     * Public because "send what is sendable now" is a real operation and not
     * only the timer's business: the e2e suites drive a batch on demand rather
     * than waiting for an interval to come round, and so does a deployment that
     * runs the sender out of process.
     */
    async runOnce(): Promise<void> {
        try {
            const claimed = await this.deliveries.claim(
                this.config.batchSize,
                this.config.claimLeaseMs
            );

            for (const mail of claimed) {
                if (this.stopped) break;
                await this.deliver(mail);
            }

            await this.sweepIfDue();
        } catch (error) {
            // A failing tick must never kill the interval; the next one retries
            // from whatever state the database is in.
            this.logger.error(
                'A mail delivery tick failed',
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /** Hands one message over and records what happened. */
    private async deliver(mail: ClaimedMail): Promise<void> {
        try {
            await this.provider.send({
                to: mail.toAddress,
                from: this.config.from,
                ...(this.config.replyTo
                    ? { replyTo: this.config.replyTo }
                    : {}),
                subject: mail.subject,
                // The body is sent **as it was rendered**, never regenerated:
                // a second attempt must carry the same link as the first, or a
                // duplicate message would invalidate the copy that arrived.
                text: mail.bodyText,
                ...(mail.bodyHtml ? { html: mail.bodyHtml } : {}),
                headers: { 'X-Orthacms-Mail-Kind': mail.kind }
            });
            await this.deliveries.markDelivered(mail.id);
            return;
        } catch (error) {
            await this.recordFailure(mail, error);
        }
    }

    /** Decides whether a failed hand-off gets another attempt. */
    private async recordFailure(
        mail: ClaimedMail,
        error: unknown
    ): Promise<void> {
        const attempt = mail.attempts + 1;
        const reason = error instanceof Error ? error.message : String(error);

        // A permanent rejection stops the row **now**, with its remaining
        // budget untouched: a typo'd address would otherwise spend five
        // attempts over twenty minutes and land in the dead letters beside a
        // real outage, where an operator cannot tell them apart.
        if (error instanceof MailPermanentError) {
            await this.deliveries.markDead(mail.id, reason, this.provider.id);
            this.logger.warn(
                `A ${mail.kind} message to ${mail.toAddress} was rejected permanently: ${reason}`
            );
            return;
        }

        if (isExhausted(attempt, this.config.maxAttempts)) {
            await this.deliveries.markDead(
                mail.id,
                `Gave up after ${attempt} attempts. Last error: ${reason}`,
                this.provider.id
            );
            this.logger.warn(
                `A ${mail.kind} message to ${mail.toAddress} was given up on after ${attempt} attempts: ${reason}`
            );
            return;
        }

        await this.deliveries.markRetrying(
            mail.id,
            reason,
            new Date(Date.now() + nextAttemptDelayMs(attempt)),
            this.provider.id
        );
    }

    /**
     * Deletes messages whose token has expired, at most once per
     * `sweepIntervalMs`.
     *
     * Nothing else prunes this table — a delivered row is deleted by the send
     * itself, but one that was never claimed (delivery switched off, a relay
     * down for longer than the token lives) would otherwise sit there holding a
     * secret nobody can use.
     */
    private async sweepIfDue(): Promise<void> {
        if (Date.now() - this.lastSweptAt < this.config.sweepIntervalMs) return;
        this.lastSweptAt = Date.now();

        const removed = await this.deliveries.sweepExpired();
        if (removed > 0) {
            this.logger.log(
                `Swept ${removed} mail deliveries whose link had expired.`
            );
        }
    }
}
