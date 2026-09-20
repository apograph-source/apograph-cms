import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain events the alarms context raises.
 *
 * An alarm rule never gates a write ([ADR-0015](../../../../docs/adr/0015-alarms-are-non-blocking.md)),
 * which is exactly why its **configuration** is worth recording: the rule is
 * the thing with authority here, not the finding. A rule that is disabled,
 * re-filtered or deleted stops flagging content, and everything downstream — an
 * editor's checks block, the records column, the alarms page — simply goes
 * quiet. Nothing about that quiet says anybody chose it, and the rule row that
 * would have explained it is gone.
 *
 * Findings themselves raise nothing, and should not: they are produced by an
 * evaluator over content the log already records, one per matching entry per
 * sweep, and auditing them would turn the trail into a metrics feed.
 */
export const ALARM_EVENT_KINDS = {
    /** A rule was written, with the filter it stores verbatim. */
    RULE_CREATED: 'alarm.rule.created',
    /**
     * A rule was edited. Disabling one is an update, and it is the update most
     * worth having a row for — a disabled rule looks exactly like a rule that
     * finds nothing.
     */
    RULE_UPDATED: 'alarm.rule.updated',
    /** A rule was deleted, taking its findings with it by FK cascade. */
    RULE_DELETED: 'alarm.rule.deleted',
    /**
     * A rule was re-run across its whole collection by hand.
     *
     * The manual recovery path, so a row here is what explains a sudden change
     * in a workspace's finding counts that no rule edit accounts for.
     */
    RULE_RESCANNED: 'alarm.rule.rescanned'
} as const;

/** Builds an alarm-rule {@link DomainEvent}, stamping the aggregate type + id. */
export function alarmRuleEvent(
    kind: string,
    ruleId: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'alarm_rule',
        aggregateId: ruleId,
        payload
    });
}
