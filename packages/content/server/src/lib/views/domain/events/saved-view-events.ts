import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain events a saved view raises.
 *
 * A view is a bookmark rather than a grant — it is replayed through the
 * ordinary list query with the reader's own permissions, so it can never show
 * anyone a row they could not already reach. That is why only three of the five
 * write routes raise anything:
 *
 * - **Create, update and delete are recorded.** A `workspace`-visible view is
 *   shared state: it appears in every member's switcher, it is the thing a team
 *   agrees "the review queue" means, and deleting one takes it away from
 *   everybody. Sharing is even its own permission (`views:share`), which is the
 *   product saying this is not purely personal.
 * - **Setting a personal default raises nothing, deliberately.** It is the
 *   reader's own landing choice — the same class of thing as `PUT
 *   /preferences` — and it is set by clicking a view. A row per click would be
 *   a usage metric wearing an audit row's clothes, and it would bury the three
 *   kinds above in a log that has no way to filter by "interesting".
 */
export const SAVED_VIEW_EVENT_KINDS = {
    CREATED: 'saved_view.created',
    UPDATED: 'saved_view.updated',
    DELETED: 'saved_view.deleted'
} as const;

/** Builds a saved-view {@link DomainEvent}, stamping the aggregate type + id. */
export function savedViewEvent(
    kind: string,
    viewId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'saved_view',
        aggregateId: viewId,
        payload
    });
}
