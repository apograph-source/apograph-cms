/**
 * Public API of `@orthacms/protection-domain` — may **this person** ship this
 * entry now, decided by one pure function over a rule, a head revision and the
 * votes recorded against it.
 *
 * Deliberately small, and deliberately about *who* rather than *what*. Whether
 * the entry is complete belongs to `content/domain`'s publish gate and stays
 * there; whether it looks wrong belongs to alarms, which never block. This
 * package answers the third question only, and it is the one nobody else asks.
 *
 * There is no `canPublish` here on purpose — see `evaluate-protection.ts`.
 */

export { countApprovals, evaluateProtection } from './lib/evaluate-protection';
export type {
    ApprovalCounts,
    ProtectionDecision
} from './lib/evaluate-protection';

export type {
    Approval,
    ProtectionActor,
    ProtectionInput,
    ProtectionRule
} from './lib/protection-rule';
