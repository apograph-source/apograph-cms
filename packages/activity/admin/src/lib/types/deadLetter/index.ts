/**
 * One outbox event that gave up — an action the system tried to record and
 * could not, after fifteen failed delivery attempts.
 *
 * The admin's view model, not the wire shape: `occurredAt` is a `Date` here
 * (`infrastructure/deadLetterMapper` does the conversion) and the presentation
 * renders it through `activityDateTime` / `intl.formatDate`, both of which
 * survive an `Invalid Date` — see `activity:I-25` and the helper's own note for
 * why that matters more here than anywhere else.
 */
export type DeadLetter = {
    /** The event id — the handle the retry route takes. */
    id: string;
    /** The event kind that could not be delivered. */
    kind: string;
    /** The aggregate root's type. */
    aggregateType: string;
    /** The aggregate root's id. */
    aggregateId: string;
    /** When the fact occurred. May be an `Invalid Date`; never substituted. */
    occurredAt: Date;
    /** How many delivery attempts were spent before it parked. */
    attempts: number;
    /**
     * Why the last attempt failed, truncated by the server; `null` when the
     * row carries no message.
     *
     * **Arbitrary server text.** It is the single field that tells an operator
     * whether the cause is fixed, so it is rendered in full as text — never as
     * markup, and never hidden behind a `title=`.
     */
    lastError: string | null;
};

/** The envelope `GET /api/activity/dead-letters` returns. */
export type DeadLetterList = {
    /** How many events have given up in total, ignoring the requested limit. */
    total: number;
    /** The most recent of them, at most `limit` rows. */
    items: DeadLetter[];
};

/**
 * A dead letter as it stands after the retry route put it back in the queue —
 * every field of {@link DeadLetter} plus the delivery schedule.
 *
 * Mirrors the server's `DeadLetterRetryView`. Nothing renders `nextAttemptAt`
 * today; it is restated rather than dropped because it is half of what the
 * reset actually did, and a mapper that quietly discards a field is how the
 * next reader concludes the field does not exist.
 */
export type RetriedDeadLetter = DeadLetter & {
    /**
     * Earliest time the row may be claimed again; `null` means "now", which is
     * what a successful retry always leaves behind.
     */
    nextAttemptAt: Date | null;
};
