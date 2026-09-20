import { createDomainEvent, type DomainEvent } from '@ortha/database';

/**
 * The domain event kinds the users context raises. Most are raised by the
 * {@link Member} aggregate on a primary lifecycle transition; a few
 * (`profile_updated`, `reactivated`, `invite_resent`, `password_reset_issued`,
 * `invite_link_revealed`) are secondary facts the
 * application mints directly, mirroring identity's `auth.*` flow events — the
 * aggregate deliberately stays quiet on them (see {@link Member.rename} /
 * {@link Member.enable}).
 *
 * These `member.*` kinds are **distinct** from the `user.*` audit kinds the
 * audit trail uses, whose catalogue lives with the subscriber that writes it
 * (`USER_AUDIT_KINDS` in `activity/server/…/audit-event-mapping.ts`). Unlike
 * the workspaces
 * pilot (whose event kinds mirror its audit kinds one-to-one), the users context
 * keeps the two catalogues separate, so the activity outbox subscriber maps
 * `member.*` → `user.*` rather than reusing the same strings.
 */
export const MEMBER_EVENT_KINDS = {
    INVITED: 'member.invited',
    INVITE_RESENT: 'member.invite_resent',
    PASSWORD_RESET_ISSUED: 'member.password_reset_issued',
    INVITE_LINK_REVEALED: 'member.invite_link_revealed',
    PROFILE_UPDATED: 'member.profile_updated',
    ROLE_CHANGED: 'member.role_changed',
    DISABLED: 'member.disabled',
    REACTIVATED: 'member.reactivated',
    REMOVED: 'member.removed'
} as const;

/** The aggregate type stamped on every member domain event. */
const AGGREGATE_TYPE = 'member';

/**
 * Builds a member {@link DomainEvent} of `kind` for `memberId`, carrying
 * `payload`. Keeps the aggregate free of the event envelope's plumbing — the
 * aggregate names the fact and its data; this stamps the `aggregateType`/id.
 */
export function memberEvent(
    kind: string,
    memberId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: memberId,
        payload
    });
}
