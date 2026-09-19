/** Default page size for `GET /api/activity`. */
export const DEFAULT_PAGE_SIZE = 25;

/** Upper bound on the requested page size (the largest option the UI offers). */
export const MAX_PAGE_SIZE = 100;

/**
 * Max length of the raw `?filter=` JSON string — a coarse first guard against
 * oversized payloads, ahead of the filter engine's own budgets.
 *
 * Re-exported rather than declared: the number belongs to the engine that
 * enforces the rest of the filter's limits, and four packages each declaring
 * their own copy is how one of them (`alarms`) came to say 8192 while the other
 * three said 4096. See `filters/budgets.ts` in `@apograph/utils-server`.
 */
export { FILTER_MAX_LENGTH } from '@apograph/utils-server';

/**
 * The audit vocabulary of the one action this plugin **performs** rather than
 * records: putting a parked outbox event back in the queue.
 *
 * Every other kind in the catalogue is owned by the plugin that raises it, and
 * this one is no different — it just happens that the raiser is Activity. Kept
 * here, at the feature root beside the other feature data, so the controller
 * that emits the event and the mapper that consumes it name the same strings
 * instead of two string literals that drift.
 */
export const OUTBOX_RETRY_AUDIT = {
    /** The event kind, which is also the audit kind — they do not differ here. */
    KIND: 'outbox.event_retried',
    /**
     * What was acted upon. `outbox_event` is a subject type in its own right:
     * the thing retried is the delivery of an event, not the aggregate the
     * event is about, and stamping the latter would file the row under a
     * workspace or an entry that nobody touched.
     */
    SUBJECT_TYPE: 'outbox_event'
} as const;

/** Columns the read API permits sorting by (whitelist — keys are the wire values). */
export const SORTABLE_FIELDS = ['at', 'kind'] as const;

/** A field the read API may sort by. */
export type SortableField = (typeof SORTABLE_FIELDS)[number];

/** Sort directions the read API accepts. */
export const SORT_ORDERS = ['asc', 'desc'] as const;

/** A sort direction accepted by the read API. */
export type SortOrder = (typeof SORT_ORDERS)[number];
