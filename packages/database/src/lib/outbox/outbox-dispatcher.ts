import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy
} from '@nestjs/common';
import {
    and,
    count,
    desc,
    eq,
    gte,
    isNull,
    lt,
    lte,
    or,
    sql
} from 'drizzle-orm';
import type { Database } from '../types';
import { InjectDatabase, InjectOutboxRetentionDays } from '../database.tokens';
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
    /** The event id — the handle {@link OutboxDispatcher.retryDeadLetter} takes. */
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
 * A dead letter as it stands **after** {@link OutboxDispatcher.retryDeadLetter}
 * has put it back in the queue.
 *
 * Every field of {@link DeadLetter} plus `nextAttemptAt`, because the schedule
 * is the half of the reset a caller cannot otherwise see and the half that
 * decides whether anything actually happens: clearing `attempts` while leaving
 * a `next_attempt_at` up to five minutes in the future produces a row the claim
 * predicate still refuses, so the operator presses retry and nothing moves.
 * Returning it makes that assertable from the outside.
 */
export interface RetriedDeadLetter extends DeadLetter {
    /**
     * Earliest time the row may be claimed again; `null` means "now", which is
     * what a successful retry always leaves behind.
     */
    nextAttemptAt: Date | null;
}

/**
 * What {@link OutboxDispatcher.retryDeadLetter} found.
 *
 * A discriminated union rather than thrown errors, because this package models
 * no HTTP and has no error hierarchy of its own: the caller that owns a
 * transport decides that `'not-found'` is a 404 and `'not-parked'` a 409.
 *
 * `'not-found'` deliberately covers two situations — no such row, and a row
 * that has already been delivered. They are indistinguishable on purpose: a
 * caller who should not know an event id exists must not be able to learn it
 * from the difference between "unknown" and "already done".
 */
export type RetryDeadLetterResult =
    | {
          /** The row was parked and has been put back in the queue. */
          outcome: 'retried';
          /** The row as it now stands. */
          event: RetriedDeadLetter;
      }
    | {
          /** No such undispatched row — unknown id, or already delivered. */
          outcome: 'not-found';
      }
    | {
          /** The row exists and is undelivered, but has not given up yet. */
          outcome: 'not-parked';
          /** How many attempts it has spent so far. */
          attempts: number;
      };

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
 * How long a **delivered** row is kept before the sweep removes it, in days,
 * when the host configures nothing.
 *
 * Thirty days is the same answer the webhook delivery log gives, and for the
 * same reason: long enough that "did that event go out last month" is still a
 * question the table can answer, short enough that the table is not a permanent
 * copy of every fact the system has ever recorded. `0` turns the sweep off,
 * which is a real choice for a low-volume install and unbounded growth for any
 * other.
 */
export const DEFAULT_OUTBOX_RETENTION_DAYS = 30;

/** How many delivered rows one sweep pass deletes. */
const PRUNE_BATCH_SIZE = 1_000;

/**
 * Hard cap on the passes a single sweep makes.
 *
 * The pool ceiling is 10 clients and a drain already holds one for its whole
 * batch, so a sweep that kept going until the table was clean would compete
 * with live traffic for the rest. Ten batches is 10 000 rows per tick, and the
 * tick after it takes the next ten thousand.
 */
const PRUNE_MAX_BATCHES = 10;

/** Milliseconds between retention sweeps — at most one an hour. */
const PRUNE_INTERVAL_MS = 60 * 60_000;

/** Milliseconds in a day, for turning a retention window into a cutoff. */
const DAY_MS = 24 * 60 * 60_000;

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
 * fixed the cause puts one back in the queue with
 * {@link OutboxDispatcher.retryDeadLetter}, which resets the row **in place**
 * rather than enqueuing a copy.
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

    /**
     * When the retention sweep last ran, as an epoch millisecond count.
     *
     * An **in-process field**, not a row: `database:I-23` says this package
     * owns exactly one table, and a `last_pruned_at` bookkeeping table would be
     * a second one. The cost of keeping it in memory is that a process
     * restarted every ten minutes never prunes — which is a development
     * pattern, not a deployment one, and the sweep is idempotent besides.
     */
    private lastPrunedAt = 0;

    constructor(
        @InjectDatabase() private readonly db: Database,
        @Inject(DOMAIN_EVENT_SUBSCRIBERS)
        private readonly injectedSubscribers: DomainEventSubscriber[],
        @InjectOutboxRetentionDays()
        private readonly retentionDays: number
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

    /**
     * Puts one parked event back in the queue — the un-park primitive, offered
     * as a method so an operator does not need a `psql` session to use it.
     *
     * **It resets the existing row in place and never enqueues a copy**
     * (`database:I-12`: "the `eventId` is the idempotency key, not merely a
     * PK"). A copy with a fresh id is a *different fact* to every subscriber:
     * the activity insert is `ON CONFLICT DO NOTHING` on that same PK and
     * webhook receivers deduplicate on `X-Ortha-Event-Id`, so a delivery
     * that partly succeeded before it parked would be applied twice.
     *
     * **Both columns are cleared, and the second one is the point.** Clearing
     * `attempts` alone leaves a `next_attempt_at` up to five minutes in the
     * future, which the claim predicate honours — so the row is eligible by the
     * ceiling and ineligible by the schedule, the operator sees nothing happen,
     * and the only symptom is a delay nobody can explain. `last_error` is
     * deliberately **preserved**: it is the sole surviving evidence of why the
     * event parked, and a retry that succeeds is not a reason to destroy it.
     *
     * The row is taken `FOR UPDATE` before the decision rather than after
     * (`database:I-18`/`I-19` — this must not be the first thing in the package
     * that can block a drain). A plain lock, not `SKIP LOCKED`: this is one row
     * named by id, and skipping it would answer "not found" for a row that
     * exists. It cannot queue behind a drain either, because a parked row is by
     * definition one the drain no longer claims.
     *
     * @param id The parked event's id.
     * @param executor The transaction to join. Pass `UnitOfWork.current()` to
     *   make the reset commit atomically with the audit event that records it;
     *   omitted, the reset stands alone on the base connection.
     */
    async retryDeadLetter(
        id: string,
        executor: Database = this.db
    ): Promise<RetryDeadLetterResult> {
        return executor.transaction(async (tx) => {
            const [locked] = await tx
                .select({
                    attempts: outboxEvents.attempts,
                    dispatchedAt: outboxEvents.dispatchedAt
                })
                .from(outboxEvents)
                .where(eq(outboxEvents.id, id))
                .for('update');

            // Unknown and already-delivered answer the same way, on purpose —
            // see `RetryDeadLetterResult`. A caller who cannot already see the
            // dead-letter list must not learn an id exists from the difference.
            if (!locked || locked.dispatchedAt !== null) {
                return { outcome: 'not-found' as const };
            }
            if (locked.attempts < MAX_DELIVERY_ATTEMPTS) {
                // Undelivered but still climbing its backoff: the dispatcher
                // has not given up, so there is nothing to un-park. Resetting
                // it would only hand it back an attempt budget it is already
                // spending.
                return {
                    outcome: 'not-parked' as const,
                    attempts: locked.attempts
                };
            }

            const [updated] = await tx
                .update(outboxEvents)
                .set({ attempts: 0, nextAttemptAt: null })
                // `dispatched_at IS NULL` is re-stated even though the locked
                // read just proved it: the predicate is what makes the write
                // itself safe to read in isolation, and the row lock is held
                // for the whole statement anyway.
                .where(
                    and(
                        eq(outboxEvents.id, id),
                        isNull(outboxEvents.dispatchedAt)
                    )
                )
                .returning({
                    id: outboxEvents.id,
                    kind: outboxEvents.kind,
                    aggregateType: outboxEvents.aggregateType,
                    aggregateId: outboxEvents.aggregateId,
                    occurredAt: outboxEvents.occurredAt,
                    attempts: outboxEvents.attempts,
                    nextAttemptAt: outboxEvents.nextAttemptAt,
                    lastError: outboxEvents.lastError
                });

            return updated
                ? { outcome: 'retried' as const, event: updated }
                : { outcome: 'not-found' as const };
        });
    }

    /**
     * Deletes delivered rows stamped before `before`, and answers how many went.
     *
     * **Public deliberately.** The alternative — a private `pruneIfDue` and
     * nothing else — ships a `DELETE` predicate over this table that no test
     * can reach without waiting out an hourly timer, and an unasserted `DELETE`
     * on the outbox is how a dead letter quietly stops existing. It is public
     * for the same stated reason `MailDeliveryWorker.runOnce()` is.
     *
     * **Parked rows are exempt by construction, not by a clause.** A dead
     * letter is precisely a row with `dispatched_at IS NULL`, so
     * `dispatched_at IS NOT NULL` already excludes every parked *and* every
     * pending row; there is no `AND attempts < 15` here and there must not be
     * one — that spells the same intent in a form a later edit can break, and
     * would start deleting pending rows the moment somebody "simplified" it.
     * `database:I-14` is what makes the stamp trustworthy as a deletion
     * criterion: "a row is stamped `dispatched_at` only after **every**
     * matching subscriber has finished without throwing".
     *
     * The cut is on `dispatched_at`, never `occurred_at`. They are different
     * clocks — an event can occur long before it is delivered — and cutting on
     * domain time would delete a row that was delivered this morning because
     * the fact it carries is old.
     *
     * Deletes in batches of {@link PRUNE_BATCH_SIZE} through a `FOR UPDATE SKIP
     * LOCKED` sub-select (`database:I-19`), so the sweep takes disjoint rows
     * from a concurrent drain instead of blocking it, and stops after
     * {@link PRUNE_MAX_BATCHES} passes so one tick cannot monopolise the pool.
     */
    async pruneDelivered(before: Date): Promise<number> {
        let removed = 0;
        for (let pass = 0; pass < PRUNE_MAX_BATCHES; pass += 1) {
            const result = await this.db.execute(sql`
                DELETE FROM ${outboxEvents}
                WHERE ${outboxEvents.id} IN (
                    SELECT ${outboxEvents.id} FROM ${outboxEvents}
                    WHERE ${outboxEvents.dispatchedAt} IS NOT NULL
                      AND ${outboxEvents.dispatchedAt} < ${before}
                    LIMIT ${PRUNE_BATCH_SIZE}
                    FOR UPDATE SKIP LOCKED
                )
            `);
            const deleted = result.rowCount ?? 0;
            removed += deleted;
            // A short pass means the window is clean; anything else is a full
            // batch and there may be more behind it.
            if (deleted < PRUNE_BATCH_SIZE) {
                break;
            }
        }
        return removed;
    }

    /**
     * Runs {@link pruneDelivered} at most once an hour, at the tail of a poll
     * tick.
     *
     * **No new timer.** The poll backstop already ticks every five seconds and
     * already skips itself while a drain runs; hanging the sweep off it is the
     * shape `WebhookDeliveryWorker` uses, and it means the sweep inherits the
     * one interval the shutdown hook already knows how to stop.
     *
     * It runs **outside** the claim transaction — after `drain()` has returned,
     * not inside `drainOnce` — so a long sweep can never extend the bounded
     * wait `onModuleDestroy` makes on an in-flight drain (`database:I-20`).
     *
     * **The hourly mark is claimed up front and handed back on failure.**
     * Claiming it before the `await` is what stops two sweeps overlapping: this
     * runs after `pollOnce` has already cleared its `draining` flag, so a sweep
     * that outlives the five-second tick would otherwise be joined by the next
     * one. But a sweep that *threw* has swept nothing, and leaving the mark
     * armed suppressed every retry for a full hour over, typically, a momentary
     * connection error — with `pollOnce` logging a comment that said the next
     * tick would pick it up. So the failure path restores the previous mark and
     * the next tick genuinely retries.
     */
    private async pruneIfDue(): Promise<void> {
        if (this.retentionDays <= 0) {
            return;
        }
        const now = Date.now();
        if (now - this.lastPrunedAt < PRUNE_INTERVAL_MS) {
            return;
        }
        const previous = this.lastPrunedAt;
        this.lastPrunedAt = now;

        let removed: number;
        try {
            removed = await this.pruneDelivered(
                new Date(now - this.retentionDays * DAY_MS)
            );
        } catch (error) {
            // Hand the window back before rethrowing; `pollOnce` logs.
            this.lastPrunedAt = previous;
            throw error;
        }
        // Silent when there was nothing to do: an hourly "pruned 0 rows" line
        // is noise that trains a reader to skip the ones that matter. A
        // *failure* is never silent — it is logged by `pollOnce`, which is the
        // only caller and the one place the retry decision is visible.
        if (removed > 0) {
            this.logger.log(
                `Pruned ${removed} delivered outbox events older than ${this.retentionDays} days.`
            );
        }
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

    /**
     * One guarded poll tick — skips if a drain is already running.
     *
     * The retention sweep rides on the tail of this rather than on a timer of
     * its own, and **after** the drain has returned rather than inside it: the
     * drain's transaction is what `onModuleDestroy` waits out, and a sweep
     * inside it would make that wait unbounded by a second thing
     * (`database:I-20`).
     */
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
        try {
            await this.pruneIfDue();
        } catch (error) {
            // A failing sweep must never kill the interval, and it must not
            // consume its hourly slot either: `pruneIfDue` restores the mark
            // before it throws, so the next tick really does retry from
            // whatever state the database is in.
            this.logger.error(
                'Outbox retention sweep failed',
                error instanceof Error ? error.stack : String(error)
            );
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
