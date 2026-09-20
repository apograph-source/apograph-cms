import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { Database } from '../types';
import { InjectDatabase } from '../database.tokens';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher';

/**
 * The ambient transactional context carried through an async call tree
 * by {@link UnitOfWork}. Holds the active transaction executor so nested
 * repository calls transparently join it.
 */
interface UowContext {
    /** The active transaction, used as the executor by everything inside `run`. */
    tx: Database;
}

/**
 * The application-boundary primitive that runs a unit of work inside a
 * single database transaction and drains the outbox once it commits.
 *
 * A use case wraps its work in {@link run}; repositories call
 * {@link current} to obtain the executor, so every read and write in the
 * tree joins the **same** transaction without threading a `tx` argument
 * through the call stack. The transaction handle is propagated implicitly
 * via node's `AsyncLocalStorage`.
 */
@Injectable()
export class UnitOfWork {
    private readonly als = new AsyncLocalStorage<UowContext>();
    private readonly logger = new Logger(UnitOfWork.name);

    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly dispatcher: OutboxDispatcher
    ) {}

    /**
     * Runs `fn` inside a transaction. A **nested** call (one already inside
     * a `run`) simply awaits `fn`, joining the outer transaction rather than
     * opening a new one — so the whole tree commits or rolls back together.
     *
     * After the outermost transaction commits, the outbox is drained
     * best-effort: any failure is swallowed because the poll backstop will
     * retry. The state change is already durable at that point.
     *
     * **Swallowed, but no longer silent.** A subscriber that throws is caught
     * and logged inside `drainOnce`, so a rejection reaching here is the drain
     * itself failing — a lost connection, a pool timeout — and until this line
     * existed that produced no output at all. Callers that wanted the post-drain
     * to be visible were logging it themselves around their own `drain()`, which
     * is the duplication this ends; `warn`, not `error`, because the backstop
     * will pick the events up and nothing was lost.
     */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.als.getStore()) {
            // Already inside a unit of work — join the outer transaction.
            return fn();
        }

        const result = await this.db.transaction((tx) =>
            this.als.run({ tx }, fn)
        );

        // Post-commit, best-effort drain. Swallow — the poll backstop retries —
        // but say so, or a drain that never ran leaves no trace anywhere.
        try {
            await this.dispatcher.drain();
        } catch (error) {
            this.logger.warn(
                'Post-commit outbox drain failed; the poll backstop will ' +
                    `deliver these events. ${
                        error instanceof Error ? error.message : String(error)
                    }`
            );
        }

        return result;
    }

    /**
     * Returns the executor to run queries against — the ambient transaction
     * when called inside {@link run}, otherwise the base connection. This is
     * how repositories transparently join the active transaction.
     */
    current(): Database {
        return this.als.getStore()?.tx ?? this.db;
    }

    /**
     * Whether a unit of work is active on this async call tree — i.e. whether
     * {@link current} would return a transaction rather than the base pool.
     *
     * `current()` falling back to the base connection is deliberate: a read
     * outside a unit of work is ordinary and should not have to opt in. It is
     * only a *write* that must not be silently detached from the transaction it
     * belongs to, so the check is offered here and enforced by the caller that
     * needs it (`OutboxWriter.append`) rather than by `current()` itself.
     */
    isActive(): boolean {
        return this.als.getStore() !== undefined;
    }
}
