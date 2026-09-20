import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain events the copilot context raises.
 *
 * Two things are recorded and two deliberately are not, and the line between
 * them is whether a person granted the agent something.
 *
 * **Recorded.** A **skill** is standing instruction: it changes what the
 * copilot does in a workspace for everyone, on every future run, and a skill
 * flipped to `auto` runs without anybody asking for it. A **tool permission**
 * is the same decision at one moment — a person allowing one parked call to
 * proceed. Both are authority granted to an agent by a human, which is the
 * thing an audit trail exists for.
 *
 * **Not recorded.** Starting a run raises nothing: a run is a conversation
 * turn, and everything a run actually *does* is already audited at the point it
 * does it — an applied change is an `entry.*` row carrying its own `runId`
 * (ADR-0009 applies directly, so there is no separate approval to record).
 * Renaming a conversation raises nothing either; it is a title on the author's
 * own thread. Both would be usage metrics in a log that has no way to filter
 * them out.
 */
export const COPILOT_EVENT_KINDS = {
    /** A skill was written into a workspace. */
    SKILL_CREATED: 'copilot.skill.created',
    /**
     * A skill was edited.
     *
     * `mode` and `enabled` are the two that matter: `auto` means it applies
     * without being asked for, and a disabled skill is indistinguishable from
     * one that never matched.
     */
    SKILL_UPDATED: 'copilot.skill.updated',
    /** A skill was deleted. */
    SKILL_DELETED: 'copilot.skill.deleted',
    /**
     * A person allowed or refused one tool call in a running turn.
     *
     * Bounded by human interaction — one decision per parked call — so this is
     * not the volume problem auditing runs would be. It is the moment a human
     * hands the agent authority it did not otherwise hold, and the run's own
     * transcript is not an audit store.
     */
    TOOL_PERMISSION_DECIDED: 'copilot.tool_permission.decided'
} as const;

/** Builds a copilot-skill {@link DomainEvent}, stamping the aggregate type + id. */
export function copilotSkillEvent(
    kind: string,
    skillId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'copilot_skill',
        aggregateId: skillId,
        payload
    });
}

/**
 * Builds the `copilot.tool_permission.decided` event.
 *
 * The aggregate is the **run**, because that is the thing the decision is
 * about and the handle a reviewer has: a transcript is read by run id, and the
 * tool call this answered is one field inside it.
 */
export function toolPermissionEvent(
    runId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind: COPILOT_EVENT_KINDS.TOOL_PERMISSION_DECIDED,
        aggregateType: 'copilot_run',
        aggregateId: runId,
        payload
    });
}
