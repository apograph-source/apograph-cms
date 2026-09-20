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
 * three said 4096. See `filters/budgets.ts` in `@ortha/utils-server`.
 */
export { FILTER_MAX_LENGTH } from '@ortha/utils-server';

/** Columns the read API permits sorting by (whitelist — keys are the wire values). */
export const SORTABLE_FIELDS = ['at', 'kind'] as const;

/** A field the read API may sort by. */
export type SortableField = (typeof SORTABLE_FIELDS)[number];

/** Sort directions the read API accepts. */
export const SORT_ORDERS = ['asc', 'desc'] as const;

/** A sort direction accepted by the read API. */
export type SortOrder = (typeof SORT_ORDERS)[number];
