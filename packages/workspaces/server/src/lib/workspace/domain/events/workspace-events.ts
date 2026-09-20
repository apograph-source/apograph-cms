import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain event kinds the {@link Workspace} aggregate raises — one per
 * state change, as dotted names. Their string values match the audit kinds the
 * activity recorder writes in-band, so an outbox subscriber (Wave 3) can take
 * over auditing without changing the recorded `kind`.
 */
export const WORKSPACE_EVENT_KINDS = {
    CREATED: 'workspace.created',
    UPDATED: 'workspace.updated',
    ARCHIVED: 'workspace.archived',
    UNARCHIVED: 'workspace.unarchived',
    DELETED: 'workspace.deleted',
    MEMBER_ADDED: 'workspace.member_added',
    MEMBER_REMOVED: 'workspace.member_removed',
    CONTENT_GRANTED: 'workspace.content_granted',
    CONTENT_REVOKED: 'workspace.content_revoked'
} as const;

/** The aggregate type stamped on every workspace domain event. */
const AGGREGATE_TYPE = 'workspace';

/**
 * Builds a workspace {@link DomainEvent} of `kind` for `workspaceId`, carrying
 * `payload`. Keeps the aggregate free of the event envelope's plumbing — the
 * aggregate names the fact and its data; this stamps the `aggregateType`/id.
 */
export function workspaceEvent(
    kind: string,
    workspaceId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: workspaceId,
        payload
    });
}
