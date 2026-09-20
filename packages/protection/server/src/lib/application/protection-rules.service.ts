import { Injectable } from '@nestjs/common';
import {
    attachActor,
    OutboxWriter,
    UnitOfWork,
    type EventActor
} from '@orthacms/database';
import {
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { UnknownProtectedContentTypeError } from '../domain/errors';
import { protectionRuleEvent } from '../protection.events';
import { ProtectionRuleRepository } from '../infrastructure/protection-rule.repository';
import type { ProtectionRuleView } from '../types/protection-views';
import type { SaveProtectionRuleDto } from './dto/save-protection-rule.dto';

/**
 * The six defaults a rule takes for any field a write leaves unstated.
 *
 * They are the design document's table, and they are chosen so that a rule
 * saved with `{ enabled: true }` and nothing else is the **safest** useful
 * rule: one approval, from somebody other than the author, stale votes not
 * counted, and no token publishing. An administrator can still get past it,
 * loudly — turning that off is a deliberate act, not a default.
 */
const RULE_DEFAULTS = {
    enabled: false,
    requiredApprovals: 1,
    requireOtherPerson: true,
    countStaleApprovals: false,
    adminBypass: true,
    allowTokenPublish: false
} as const;

/**
 * The rule lifecycle: read, write, remove.
 *
 * Thin on purpose. The only judgement here is **which types a workspace may
 * write a rule for**, and it is deliberately the same judgement content makes
 * about the type itself — a rule addressed at a type the workspace was never
 * granted is meaningless, and answering differently for "unknown" and
 * "ungranted" would turn this tab into a way to enumerate the deployment's
 * content model.
 *
 * The decision the rules feed — may this person publish this entry — is
 * `evaluateProtection` in `@orthacms/protection-domain`, and it is not
 * duplicated here. This service does not read approvals or revisions at all.
 */
@Injectable()
export class ProtectionRulesService {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly rules: ProtectionRuleRepository,
        private readonly grants: WorkspaceGrantsQuery,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry
    ) {}

    /**
     * Every rule the workspace holds — **including** any addressed at a type it
     * is no longer granted.
     *
     * Filtering those out would leave a row nothing in the product could reach
     * and nothing could delete. A grant revoked after a rule was written is
     * exactly the case where an administrator needs to see the leftover in
     * order to remove it.
     */
    list(workspaceId: string): Promise<ProtectionRuleView[]> {
        return this.rules.list(workspaceId);
    }

    /** One type's rule, or `null` when it is unprotected. */
    find(
        workspaceId: string,
        kind: string,
        slug: string
    ): Promise<ProtectionRuleView | null> {
        return this.rules.find(workspaceId, kind, slug);
    }

    /**
     * Writes the rule for one type, inserting or replacing it.
     *
     * Throws {@link UnknownProtectedContentTypeError} when the workspace cannot
     * reach the type — the caller maps that to a 404.
     */
    async save(
        workspaceId: string,
        kind: string,
        slug: string,
        dto: SaveProtectionRuleDto,
        actor?: EventActor
    ): Promise<ProtectionRuleView> {
        await this.assertGranted(workspaceId, kind, slug);

        // Read before the write so the event can carry both sides. A rule that
        // went from two approvals to one is the change worth having a row for,
        // and "now requires 1" on its own does not say that anything moved.
        const before = await this.rules.find(workspaceId, kind, slug);

        // The unit of work is what makes the row and the event that describes
        // it commit together — an audit trail that can disagree with the state
        // it describes is worse than none.
        return this.uow.run(async () => {
            const after = await this.rules.save(workspaceId, kind, slug, {
                ...RULE_DEFAULTS,
                ...definedOnly(dto),
                updatedBy: actor?.id ?? null
            });
            await this.emit(
                after.id,
                {
                    workspaceId,
                    kind,
                    slug,
                    action: before ? 'updated' : 'created',
                    from: before ? snapshot(before) : null,
                    to: snapshot(after)
                },
                actor
            );
            return after;
        });
    }

    /**
     * Removes the rule for one type. Idempotent, and it does **not** check the
     * grant.
     *
     * Removing protection is always allowed to succeed: a rule left behind by a
     * revoked grant is precisely the row an administrator is trying to clear,
     * and a 404 would strand it. Reports whether a row was actually there, for
     * the audit trail — a delete that removed nothing is not a policy change.
     */
    async remove(
        workspaceId: string,
        kind: string,
        slug: string,
        actor?: EventActor
    ): Promise<boolean> {
        const before = await this.rules.find(workspaceId, kind, slug);
        return this.uow.run(async () => {
            const removed = await this.rules.remove(workspaceId, kind, slug);
            // A delete that removed nothing is not a policy change, and a row
            // saying otherwise would make the log's count of "protection was
            // weakened" meaningless. `before` is what the event carries: after
            // this commits there is nowhere left to look the numbers up.
            if (removed && before) {
                await this.emit(
                    before.id,
                    {
                        workspaceId,
                        kind,
                        slug,
                        action: 'removed',
                        from: snapshot(before),
                        to: null
                    },
                    actor
                );
            }
            return removed;
        });
    }

    /**
     * Append the rule event to the outbox from inside the active unit of work.
     *
     * Every rule write raises one — **including switching a rule off and
     * lowering its count** (`protection:I-14`). Without those rows the bypass
     * is not a button somebody had to justify in the log; it is a settings tab
     * left open for two minutes, and nothing afterwards can tell the difference
     * between a rule that was never there and a rule that was quietly removed.
     */
    private async emit(
        ruleId: string,
        payload: Record<string, unknown>,
        actor?: EventActor
    ): Promise<void> {
        const event = protectionRuleEvent(ruleId, payload);
        await this.outbox.append(actor ? attachActor([event], actor) : [event]);
    }

    /**
     * Fails unless `(kind, slug)` names a registered content type that this
     * workspace has been granted.
     *
     * All three failures raise the same error — unregistered, wrong kind, and
     * ungranted — which is content's own `resolveGrantedType` rule: telling
     * them apart lets a member of one workspace enumerate the deployment's
     * content model through this tab.
     */
    private async assertGranted(
        workspaceId: string,
        kind: string,
        slug: string
    ): Promise<void> {
        const type = this.registry.get(slug);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || type.kind !== kind || !granted.has(slug)) {
            throw new UnknownProtectedContentTypeError(kind, slug);
        }
    }
}

/**
 * The DTO's stated fields only.
 *
 * `PUT` replaces, so an absent key must fall through to the default — but
 * spreading the DTO straight over the defaults would let an explicit
 * `undefined` (which `class-transformer` produces for an omitted optional)
 * overwrite a default with nothing and store a null. Dropping undefined keys
 * first is what makes "omitted means default" true rather than nearly true.
 */
function definedOnly(
    dto: SaveProtectionRuleDto
): Partial<SaveProtectionRuleDto> {
    return Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined)
    );
}

/**
 * The six fields the audit row records, on each side of a change.
 *
 * The addressing and the timestamps are left out: `(kind, slug)` already rides
 * on the event, and a diff whose only difference is `updatedAt` reads as a
 * change that never happened.
 */
function snapshot(rule: ProtectionRuleView) {
    return {
        enabled: rule.enabled,
        requiredApprovals: rule.requiredApprovals,
        requireOtherPerson: rule.requireOtherPerson,
        countStaleApprovals: rule.countStaleApprovals,
        adminBypass: rule.adminBypass,
        allowTokenPublish: rule.allowTokenPublish
    };
}
