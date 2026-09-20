import type { ActivityList } from '../../types/activityEvent';
import type { DeadLetterList, RetriedDeadLetter } from '../../types/deadLetter';
import type { ActivityListParams } from '../activityKeys';

/**
 * The port over the remote activity API — the single seam the admin plugin
 * talks to instead of `apiClient` directly.
 *
 * The **log** is read-only (audit events are append-only), so the only write
 * here is the one action this plugin performs rather than records: putting a
 * parked outbox event back in the queue. That is a write against another
 * package's table through Activity's own route, not a mutation of the trail.
 *
 * Every method returns the admin's mapped view model (via the `activityMapper`
 * / `deadLetterMapper` anti-corruption layers), never the wire shape, and
 * normalizes every failure to `ApiError`, so the application hooks and the
 * presentation stay off the transport. {@link httpActivityGateway} is the HTTP
 * implementation.
 */
export type ActivityGateway = {
    /** Lists one page of audit events via `GET /api/activity`. */
    list(params: ActivityListParams): Promise<ActivityList>;
    /**
     * The events that could not be recorded, via
     * `GET /api/activity/dead-letters`. `limit` caps the returned rows; `total`
     * is the unbounded count.
     */
    deadLetters(limit: number): Promise<DeadLetterList>;
    /**
     * Puts one parked event back in the queue, via
     * `POST /api/activity/dead-letters/:id/retry`. Needs `activity:manage`.
     *
     * Rejects with an `ApiError` whose `status` carries the refusal: `404` for
     * an unknown id **or** one already delivered (deliberately
     * indistinguishable), `409` for a row that exists and is undelivered but
     * has not given up yet, `403` when the caller lost the permission.
     */
    retryDeadLetter(id: string): Promise<RetriedDeadLetter>;
};
