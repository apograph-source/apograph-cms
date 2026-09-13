import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy
} from '@nestjs/common';
import { and, count, desc, eq, gte, isNull, lt, lte, or } from 'drizzle-orm';
import type { Database } from '../types';
import { InjectDatabase } from '../database.tokens';
import {
    DOMAIN_EVENT_SUBSCRIBERS,
    type DomainEvent,
    type DomainEventSubscriber
} from '../events/domain-event';
import { outboxEvents } from '../schema/outbox-events';

/**
 * One event that gave up — what {@link OutboxDispatcher.deadLetters} reports.
 *
 * The payload is deliberately absent: it is arbitrary domain data, some of it
 * user-authored, and this is read over an HTTP route by an operator asking
 * *what* is stuck rather than replaying it. The id is enough to fetch one.
 */
export interface DeadLetter {
    /** The event id — the handle for a manual replay (`attempts = 0`). */
    id: string;
    /** The event kind that could not be delivered. */
    kind: string;
    /** The aggregate root's type. */
    aggregateType: string;
    /** The aggregate root's id. */
    aggregateId: string;
    /** When the fact occurred. */
    occurredAt: Date;
    /** How many delivery attempts were spent before it parked. */
    attempts: number;
    /** Why the last attempt failed, truncated. */
    lastError: string | null;
}

/**
 * How much of a failure's text is worth keeping on the row.
 *
 * A stack trace is diagnostics, and diagnostics belong in logs; what the row
 * needs is enough to tell one cause from another at a glance.
 */
const MAX_LAST_ERROR_CHARS = 1_000;

/** The failure, as the one line stored on the row. */
function describeFailure(error: unknown): string {
    const text =
        error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
    return text.length > MAX_LAST_ERROR_CHARS
        ? `${text.slice(0, MAX_LAST_ERROR_CHARS - 1)}…`
        : text;
}

/** How many pending events a single drain claims and delivers. */
const DRAIN_BATCH_SIZE = 100;

/** How often the poll backstop drains, in milliseconds. */
const POLL_INTERVAL_MS = 5_000;

/**
 * How many failed deliveries a row gets before the drain stops claiming it.
 *
 * Without a ceiling, `attempts` is written and never read: a row whose
 * subscriber can never succeed is re-selected on every tick forever, and
 * because the claim is `ORDER BY occurred_at LIMIT 100`, a full batch of such
 * rows sits permanently at the head of the queue and no newer event is ever
 * delivered again. Parking the row at the cap leaves it in the table —
 * `dispatched_at IS NULL AND attempts >= MAX_DELIVERY_ATTEMPTS` is the
 * dead-letter query — and lets the queue behind it move. An operator who has
 * fixed the cause replays a parked row by clearing `attempts`.
 *
 * Paired with {@link nextAttemptAfter}: the count only bounds anything because
 * each attempt is spaced out, so 15 of them is about half an hour, not fifteen
 * consecutive drains.
 */
export const MAX_DELIVERY_ATTEMPTS = 15;

/** Delay before the first retry; doubles with each further failure. */
const RETRY_BASE_DELAY_MS = 1_000;

/** Ceiling on the retry delay, so the backoff plateaus instead of running away. */
const RETRY_MAX_DELAY_MS = 5 * 60_000;

/**
 * When a row that has now failed `attempts` times may be claimed again.
 *
 * The delay is what makes {@link MAX_DELIVERY_ATTEMPTS} mean something. Drains
 * are triggered by commits, so on a busy server they run back to back: an
 * attempt ceiling with no delay would be spent in milliseconds, and a
 * subscriber that was merely unreachable for a moment would have every one of
 * its events parked before it came back. Doubling from a second and plateauing
 * at five minutes gives roughly a half-hour window before a row is treated as
 * a dead letter.
 */
export function nextAttemptAfter(attempts: number, now: Date): Date {
    const delay = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** (attempts - 1),
        RETRY_MAX_DELAY_MS
    );
    return new Date(now.getTime() + delay);
}

/**
 * Drains the transactional outbox and delivers each event to its
 * subscribers. Two triggers feed it: {@link UnitOfWork} calls
 * {@link drain} right after a unit of work commits (the fast path), and a
 * lightweight poll backstop drains on an interval so nothing is stranded
 * if that post-commit call is lost (crash, swallowed error).
 *
 * **Delivery is at-least-once** — subscribers must be idempotent. A drain
 * claims pending rows `FOR UPDATE SKIP LOCKED`, so drains in **different
 * processes** take disjoint rows and never block each other. Within one
 * process {@link drain} runs them one at a time on purpose: they compete for
 * the same pool, and a drain holds a client for its whole batch while the
 * subscribers it calls need clients of their own.
 */
@Injectable()
export class OutboxDispatcher
    implements OnApplicationBootstrap, OnModuleDestroy
{
    private readonly logger = new Logger(OutboxDispatcher.name);

    /** Subscribers registered at runtime via {@link register}. */
    private readonly registered: DomainEventSubscriber[] = [];

    /** Guards the poll backstop against overlapping runs. */
    private draining = false;

    /** The drain currently executing, or null when none is. */
    private active: Promise<void> | null = null;

    /** The drain waiting to start behind {@link active}, if one is queued. */
    private queued: Promise<void> | null = null;

    /** The poll backstop's interval handle; null until bootstrap. */
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        @InjectDatabase() private readonly db: Database,
        @Inject(DOMAIN_EVENT_SUBSCRIBERS)
        private readonly injectedSubscribers: DomainEventSubscriber[]
    ) {}

    /**
     * Registers a subscriber at runtime. This is the mechanism downstream
     * plugins use: from their own `OnApplicationBootstrap`, inject the
     * dispatcher and call `register(...)`. Prefer this over the
     * {@link DOMAIN_EVENT_SUBSCRIBERS} multi-provider, which Nest cannot
     * merge across independent dynamic modules.
     */
    register(subscriber: DomainEventSubscriber): void {
        this.registered.push(subscriber);
    }

    /**
     * Drains the outbox, **one drain at a time per process**.
     *
     * A drain holds a pool client for its whole batch, and every subscriber it
     * calls acquires a client of its own. Run enough drains at once and the
     * pool is held entirely by drains that are each waiting for a client that
     * can never be freed — a deadlock with no timeout, no log and no recovery,
     * reachable from a dozen concurrent requests over an outbox backlog. So
     * concurrent callers are collapsed instead: the one in flight is left
     * alone, and everyone who arrives while it runs joins a **single** queued
     * drain. That drain starts after every one of those callers committed, so
     * each still gets the guarantee it came for — its rows are drained before
     * its `await` returns — without a drain per caller.
     *
     * @see drainOnce for what a single drain does.
     */
    async drain(): Promise<void> {
        if (this.queued) {
            return this.queued;
        }
        if (!this.active) {
            return this.startDrain();
        }
        this.queued = this.active.then(
            () => this.promoteQueued(),
            () => this.promoteQueued()
        );
        return this.queued;
    }

    /** The queued drain's turn has come: it becomes the active one. */
    private promoteQueued(): Promise<void> {
        this.queued = null;
        return this.startDrain();
    }

    /** Runs one drain and tracks it as {@link active} until it settles. */
    private startDrain(): Promise<void> {
        const run = this.drainOnce();
        const settled = run.then(
            () => undefined,
            () => undefined
        );
        this.active = settled;
        void settled.then(() => {
            // Only clear if a later drain has not already claimed the slot.
            if (this.active === settled) {
                this.active = null;
            }
        });
        return run;
    }

    /**
     * Claims up to {@link DRAIN_BATCH_SIZE} undispatched events in a
     * transaction (`FOR UPDATE SKIP LOCKED`, oldest first) and delivers each
     * to every matching subscriber. On full success a row is stamped
     * `dispatchedAt`; if a subscriber throws, that row's `attempts` is
     * incremented and it stays undispatched for a later retry — one bad
     * subscriber never blocks other events. A row that has already failed
     * {@link MAX_DELIVERY_ATTEMPTS} times is no longer claimed at all, so it
     * cannot hold the head of the queue against every event behind it.
     */
    private async drainOnce(): Promise<void> {
        await this.db.transaction(async (tx) => {
            const rows = await tx
                .select()
                .from(outboxEvents)
                .where(
                    and(
                        isNull(outboxEvents.dispatchedAt),
                        lt(outboxEvents.attempts, MAX_DELIVERY_ATTEMPTS),
                        or(
                            isNull(outboxEvents.nextAttemptAt),
                            lte(outboxEvents.nextAttemptAt, new Date())
                        )
                    )
                )
                .orderBy(outboxEvents.occurredAt)
                .limit(DRAIN_BATCH_SIZE)
                .for('update', { skipLocked: true });

            for (const row of rows) {
                const event: DomainEvent = {
                    eventId: row.id,
                    kind: row.kind,
                    aggregateType: row.aggregateType,
                    aggregateId: row.aggregateId,
                    occurredAt: row.occurredAt,
                    payload: row.payload as Record<string, unknown>
                };

                try {
                    for (const subscriber of this.subscribersFor(row.kind)) {
                        await subscriber.handle(event);
                    }
                    await tx
                        .update(outboxEvents)
                        .set({ dispatchedAt: new Date() })
                        .where(eq(outboxEvents.id, row.id));
                } catch (error) {
                    const attempts = row.attempts + 1;
                    this.logger.error(
                        attempts >= MAX_DELIVERY_ATTEMPTS
                            ? `Delivery failed for event ${row.id} (${row.kind}) ` +
                                  `${attempts} times; giving up. The row stays in ` +
                                  `outbox_events undispatched and is no longer claimed — ` +
                                  `query dispatched_at IS NULL AND attempts >= ` +
                                  `${MAX_DELIVERY_ATTEMPTS} for the dead letters.`
                            : `Delivery failed for event ${row.id} (${row.kind}); will retry`,
                        error instanceof Error ? error.stack : String(error)
                    );
                    await tx
                        .update(outboxEvents)
                        .set({
                            attempts,
                            nextAttemptAt: nextAttemptAfter(
                                attempts,
                                new Date()
                            ),
                            lastError: describeFailure(error)
                        })
                        .where(eq(outboxEvents.id, row.id));
                }
            }
        });
    }

    /**
     * The events that have given up — `dispatched_at IS NULL AND attempts >=
     * {@link MAX_DELIVERY_ATTEMPTS}`, newest first, with the reason each one
     * parked.
     *
     * This is the query the parking log line has always told an operator to
     * run, offered as a method so something other than `psql` can ask it. That
     * matters more here than for a typical queue: a parked row is very often an
     * **audit** row that could not be written, and a gap in the trail that is
     * only visible to somebody who thinks to go looking is barely a gap that
     * exists. `total` is separate from `items` so a caller can render "3 events
     * could not be recorded" without paging.
     *
     * `newerThan` narrows to recent failures, for a caller that has already
     * acknowledged older ones.
     */
    async deadLetters(
        options: { limit?: number; newerThan?: Date } = {}
    ): Promise<{
        total: number;
        items: DeadLetter[];
    }> {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const where = and(
            isNull(outboxEvents.dispatchedAt),
            gte(outboxEvents.attempts, MAX_DELIVERY_ATTEMPTS),
            options.newerThan
                ? gte(outboxEvents.occurredAt, options.newerThan)
                : undefined
        );
        const [[counted], rows] = await Promise.all([
            this.db.select({ total: count() }).from(outboxEvents).where(where),
            this.db
                .select({
                    id: outboxEvents.id,
                    kind: outboxEvents.kind,
                    aggregateType: outboxEvents.aggregateType,
                    aggregateId: outboxEvents.aggregateId,
                    occurredAt: outboxEvents.occurredAt,
                    attempts: outboxEvents.attempts,
                    lastError: outboxEvents.lastError
                })
                .from(outboxEvents)
                .where(where)
                .orderBy(desc(outboxEvents.occurredAt))
                .limit(limit)
        ]);
        return { total: counted?.total ?? 0, items: rows };
    }

    /** Starts the poll backstop once the app is up. */
    onApplicationBootstrap(): void {
        this.timer = setInterval(() => {
            void this.pollOnce();
        }, POLL_INTERVAL_MS);
        // Don't let the backstop keep the process alive on shutdown.
        this.timer.unref();
    }

    /**
     * Stops the poll backstop on teardown, then **waits for a drain already in
     * flight** rather than walking away from it.
     *
     * It used to only clear the interval. A drain running when `SIGTERM`
     * arrived was abandoned mid-batch: subscribers that had already run were
     * never marked delivered, the claim transaction died with the connection,
     * and those events were re-delivered on the next boot. Safe only because
     * the one shipped subscriber is idempotent — a future one that is not would
     * double-apply. Delivery is at-least-once either way, but there is no
     * reason to spend the guarantee on an orderly shutdown.
     *
     * A drain claims `FOR UPDATE SKIP LOCKED` and its batch is bounded, so this
     * waits for one batch at most. Both promises are swallowed: a failing drain
     * has already logged, and a throw from here would abort the rest of the
     * shutdown.
     */
    async onModuleDestroy(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        // `queued` resolves only after the drain it promoted has finished, so
        // awaiting it covers the active one too.
        const inFlight = this.queued ?? this.active;
        await inFlight?.catch(() => undefined);
    }

    /** One guarded poll tick — skips if a drain is already running. */
    private async pollOnce(): Promise<void> {
        if (this.draining) {
            return;
        }
        this.draining = true;
        try {
            await this.drain();
        } catch (error) {
            this.logger.error(
                'Outbox poll drain failed',
                error instanceof Error ? error.stack : String(error)
            );
        } finally {
            this.draining = false;
        }
    }

    /** All subscribers (injected + runtime-registered) that want `kind`. */
    private subscribersFor(kind: string): DomainEventSubscriber[] {
        return [...this.injectedSubscribers, ...this.registered].filter(
            (subscriber) =>
                subscriber.kinds === '*' || subscriber.kinds.includes(kind)
        );
    }
}
