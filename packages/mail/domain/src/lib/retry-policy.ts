/**
 * When a message that could not be handed over is tried again.
 *
 * Pure and framework-free, so the two decisions that matter — "is this worth
 * another attempt?" and "how long until it?" — are testable without a socket or
 * a clock.
 *
 * The schedule is shorter than the webhook one. A webhook receiver may be down
 * overnight and the event still means something in the morning; an invitation
 * is attached to a token that expires, and a message the worker is still
 * shuffling six hours later is one nobody is waiting for any more.
 */

/** How many hand-off attempts a message gets before it is given up on. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * The gap before each attempt, in milliseconds. Index `n` is the wait **after**
 * attempt `n + 1` failed — about twenty minutes end to end.
 */
export const RETRY_SCHEDULE_MS: readonly number[] = [
    15_000,
    60_000,
    5 * 60_000,
    15 * 60_000
];

/** How much random spread is applied to a scheduled wait, as a fraction. */
export const JITTER_RATIO = 0.2;

/**
 * When the message that has now failed `attempts` times may be tried again.
 *
 * Jittered by ±20 % so a backlog that built up during an outage does not hit
 * the mail server as one burst the moment it comes back — the retries scheduled
 * together would otherwise stay together for every subsequent round.
 *
 * `random` is injectable purely so the jitter is testable; production passes
 * nothing and gets `Math.random`.
 */
export function nextAttemptDelayMs(
    attempts: number,
    random: () => number = Math.random
): number {
    const index = Math.min(
        Math.max(attempts - 1, 0),
        RETRY_SCHEDULE_MS.length - 1
    );
    const base = RETRY_SCHEDULE_MS[index];
    const spread = base * JITTER_RATIO;
    // random() in [0, 1) → offset in [-spread, +spread).
    return Math.max(0, Math.round(base + (random() * 2 - 1) * spread));
}

/** Whether `attempts` failures exhaust the budget of `maxAttempts`. */
export function isExhausted(
    attempts: number,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS
): boolean {
    return attempts >= maxAttempts;
}
