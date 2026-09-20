import { Injectable, Logger } from '@nestjs/common';
import type { ToolPermissionDecision } from '@orthacms/copilot-domain';

/**
 * How long a parked run waits for an answer before giving up — **for the whole
 * run**, not per call.
 *
 * The SSE stream heartbeats every 15s, so the connection itself will survive
 * far longer than this; the limit is about the user, not the socket. Five
 * minutes is "they went to look at the entry and came back".
 *
 * Per **run** rather than per **call** because a turn may ask about several
 * calls, and the ceilings in `RunLimits` cannot bound any of it: the wall clock
 * is checked at the top of a step and a park happens inside one. Charging each
 * call its own five minutes made a single turn requesting thirty writes hold
 * the connection, the generator and the model context for two and a half
 * hours — while "they went to look and came back" is one absence, not thirty.
 */
export const DEFAULT_RUN_DECISION_BUDGET_MS = 5 * 60_000;

/**
 * How much time one {@link ToolPermissionBroker.extend} grants.
 *
 * A full fresh budget rather than a token top-up: the user pressing "I need
 * more time" is saying the first allowance was not enough, and WCAG 2.2.1 asks
 * that a limit be extendable "at least ten times" over — which repeated
 * extensions of the full amount satisfy without inventing a second number.
 */
const EXTENSION_MS = DEFAULT_RUN_DECISION_BUDGET_MS;

/**
 * How long a run's spent budget is remembered after its last park.
 *
 * There is no "run ended" signal to clean up on — the generator simply stops
 * asking — so entries are pruned opportunistically, on the next `ask`. Anything
 * older than the budget can no longer constrain a live run, because a run that
 * parked that long ago has already exhausted it.
 */
const BUDGET_TTL_MS = DEFAULT_RUN_DECISION_BUDGET_MS;

/** A decision, plus how it was reached — the timeout is not a user's `deny`. */
export interface PermissionOutcome {
    decision: ToolPermissionDecision;
    /** True when nobody answered in time. */
    timedOut: boolean;
}

/**
 * Who a parked run belongs to. Only they may answer it.
 *
 * Both halves are load-bearing and neither is redundant. `WorkspaceGuard` on
 * the answering route proves the caller belongs to *the workspace they named*,
 * which says nothing about the run: a member of workspace B naming B passes it
 * while answering a run parked in A. And `copilot:use` is held by every role,
 * so a colleague in the same workspace passes every guard on the route.
 */
export interface RunOwner {
    userId: string;
    workspaceId: string;
}

/** A run parked on one call, and who is allowed to answer for it. */
interface Waiter {
    owner: RunOwner;
    settle: (outcome: PermissionOutcome) => void;
    /** Re-arms this waiter's timer for a further {@link EXTENSION_MS}. */
    extend: () => number;
}

/**
 * Parks a run while its user decides whether one tool call may proceed.
 *
 * **In-memory, and that is a real deployment constraint, not an oversight.**
 * The promise a run awaits lives in this process, so the `POST …/permission`
 * that resolves it has to reach the same instance. A single-node self-hosted
 * CMS — which is what this is — is fine. A horizontally scaled one needs sticky
 * routing by `runId`, or this registry moved behind a shared channel. Say so in
 * the deployment notes rather than discovering it as an occasional hang.
 *
 * Four things it has to get right. The first three are ways a run could
 * otherwise be stranded forever; the fourth is who is allowed to end the wait.
 *
 * - **A timeout.** Documented above, and spent against a per-run budget. It
 *   resolves as a refusal rather than throwing, so the model is told and the
 *   answer still lands.
 * - **Abort.** The user closing the window is the common case, and the engine's
 *   `signal` fires; the waiter has to reject then, or the generator never
 *   unwinds and the run leaks.
 * - **Cleanup.** Every exit path clears the entry. A registry that only deletes
 *   on the happy path grows one dangling promise per abandoned run.
 * - **Ownership.** A `runId` is not a secret — it is handed to the client in
 *   the `run-started` frame — and it is the *only* thing the answering route
 *   used to key on. See {@link RunOwner}.
 */
@Injectable()
export class ToolPermissionBroker {
    private readonly logger = new Logger(ToolPermissionBroker.name);

    /**
     * The waiting budget, in ms. Set once from the plugin config at
     * composition; {@link DEFAULT_RUN_DECISION_BUDGET_MS} when the operator
     * said nothing.
     */
    private budgetMs = DEFAULT_RUN_DECISION_BUDGET_MS;

    /**
     * Applies the operator's configured budget. Called by the plugin module at
     * startup — a setter rather than constructor injection because the broker
     * is also constructed directly in tests, where the default is what is
     * wanted.
     */
    configure(budgetMs: number | undefined): void {
        if (budgetMs !== undefined && budgetMs > 0) this.budgetMs = budgetMs;
    }

    /**
     * What is left of `runId`'s waiting budget, in ms — what the run engine puts
     * on the permission frame as a deadline, so the prompt can show a countdown
     * and warn before it expires instead of simply vanishing (`ORT-118`).
     */
    budgetRemaining(runId: string): number {
        return this.remainingBudget(runId);
    }

    /** Waiters by `runId:callId`. */
    private readonly waiting = new Map<string, Waiter>();

    /** Milliseconds each run has already spent parked, and when it last did. */
    private readonly spent = new Map<string, { ms: number; at: number }>();

    /**
     * Waits for the user's answer to one call.
     *
     * Resolves rather than rejects on a timeout, because a refusal is an
     * ordinary tool error the model can report — the same treatment every other
     * refused call gets. Only an abort rejects, and only because that means
     * nobody is listening any more.
     */
    async ask(
        runId: string,
        callId: string,
        owner: RunOwner,
        signal: AbortSignal
    ): Promise<PermissionOutcome> {
        const key = `${runId}:${callId}`;
        const remaining = this.remainingBudget(runId);
        if (remaining <= 0) {
            // The run has already spent its whole waiting budget on earlier
            // calls in this turn. Refusing straight away is the same outcome a
            // timeout produces, without holding the connection for it.
            this.logger.warn(
                `Run ${runId}: the waiting budget is exhausted; call ${callId} was refused without asking.`
            );
            return { decision: 'deny', timedOut: true };
        }

        const askedAt = Date.now();
        return new Promise<PermissionOutcome>((resolve, reject) => {
            const settle = (outcome: PermissionOutcome) => {
                cleanup();
                resolve(outcome);
            };
            let timer: ReturnType<typeof setTimeout>;
            const expire = (after: number) => {
                timer = setTimeout(() => {
                    this.logger.warn(
                        `Run ${runId}: nobody answered the permission request ` +
                            `for call ${callId} within ${after}ms; refusing.`
                    );
                    settle({ decision: 'deny', timedOut: true });
                }, after);
            };
            expire(remaining);

            // Re-arms the timer and tells the caller how long they now have.
            // The budget already spent is *not* refunded: this grants a fresh
            // allowance rather than rewinding the clock, so a run cannot be
            // held open indefinitely by a client that never stops asking
            // without a user pressing the button each time.
            const extend = () => {
                clearTimeout(timer);
                expire(EXTENSION_MS);
                return EXTENSION_MS;
            };
            const onAbort = () => {
                cleanup();
                reject(signal.reason ?? new Error('aborted'));
            };
            const cleanup = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                this.waiting.delete(key);
                this.charge(runId, Date.now() - askedAt);
            };

            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
            this.waiting.set(key, { owner, settle, extend });
        });
    }

    /**
     * Delivers a decision. Returns false when nothing was waiting, or when the
     * caller does not own the parked run.
     *
     * **Both answer false, hence the same 404**, deliberately: whether a run
     * exists is not something a caller who does not own it may learn, and the
     * route's message ("no longer waiting for an answer") is true either way
     * from where they stand.
     */
    decide(
        runId: string,
        callId: string,
        decision: ToolPermissionDecision,
        by: RunOwner
    ): boolean {
        const key = `${runId}:${callId}`;
        const waiter = this.waiting.get(key);
        if (!waiter) {
            return false;
        }
        if (
            waiter.owner.userId !== by.userId ||
            waiter.owner.workspaceId !== by.workspaceId
        ) {
            this.logger.warn(
                `Run ${runId}: user ${by.userId} tried to answer a permission ` +
                    'request for a run they do not own; refused.'
            );
            return false;
        }
        waiter.settle({ decision, timedOut: false });
        return true;
    }

    /**
     * Grants a parked call more time, at the user's request. Returns the new
     * allowance in ms, or `null` when nothing is waiting or the caller does not
     * own the run — the same conflation, for the same reason, as
     * {@link decide}.
     */
    extend(runId: string, callId: string, by: RunOwner): number | null {
        const waiter = this.waiting.get(`${runId}:${callId}`);
        if (!waiter) return null;
        if (
            waiter.owner.userId !== by.userId ||
            waiter.owner.workspaceId !== by.workspaceId
        ) {
            this.logger.warn(
                `Run ${runId}: user ${by.userId} tried to extend a permission ` +
                    'request for a run they do not own; refused.'
            );
            return null;
        }
        return waiter.extend();
    }

    /** What is left of `runId`'s waiting budget, pruning stale entries first. */
    private remainingBudget(runId: string): number {
        const now = Date.now();
        for (const [id, entry] of this.spent) {
            if (now - entry.at > BUDGET_TTL_MS) {
                this.spent.delete(id);
            }
        }
        return this.budgetMs - (this.spent.get(runId)?.ms ?? 0);
    }

    /** Charges `ms` of waiting to `runId`. */
    private charge(runId: string, ms: number): void {
        const entry = this.spent.get(runId);
        this.spent.set(runId, {
            ms: (entry?.ms ?? 0) + Math.max(0, ms),
            at: Date.now()
        });
    }
}
