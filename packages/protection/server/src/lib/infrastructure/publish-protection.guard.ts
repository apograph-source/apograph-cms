import { Injectable } from '@nestjs/common';
import {
    AccessPolicy,
    PERMISSIONS,
    Permission,
    PermissionsService
} from '@orthacms/identity-server';
import type {
    ContentPublishGuard,
    ContentPublishGuardContext,
    PublishVerdict
} from '@orthacms/content-server';
import { evaluateProtection } from '@orthacms/protection-domain';
import { ProtectionRuleRepository } from './protection-rule.repository';
import { ReviewApprovalRepository } from './review-approval.repository';
import { HeadRevisionQuery } from './head-revision.query';
import { bypassEvent } from '../protection.events';

/**
 * The refusal codes this guard emits. Stable strings a client branches on, so
 * they live in one place rather than inline at three call sites.
 */
export const PROTECTION_REFUSAL = {
    /** A rule is in force and the head revision is short of approvals. */
    InsufficientApprovals: 'protection.insufficient_approvals',
    /** A bearer token asked to publish a protected type that refuses tokens. */
    TokenRefused: 'protection.token_refused',
    /** A bypass was attempted by someone, or under a rule, that does not allow one. */
    BypassRefused: 'protection.bypass_refused'
} as const;

/**
 * The publish guard: the third gate, and the one that finally makes a rule mean
 * something.
 *
 * Registered with `content-server`'s `ContentPublishGuardRegistry`, so it meets
 * **every** caller of the publish path at once — the admin's button, the public
 * REST route, the GraphQL mutation and the MCP tool, which all funnel through
 * the same use-cases. That single reach is the entire argument for a port
 * instead of a patch: there is no list of callers to keep up to date, and a
 * route added tomorrow is covered the day it is written.
 *
 * ## What it does not do
 *
 * It never looks at a field value. Whether the entry is *complete* is the
 * publish gate's question and it has already been answered by the time this
 * runs — which is also why a bypass here cannot publish an incomplete entry:
 * the gate refused before the guard was consulted.
 *
 * It never counts votes itself. Every number comes from `evaluateProtection`,
 * the same function the entry panel reads its "1 of 2" from, so the button and
 * the refusal cannot disagree.
 */
@Injectable()
export class PublishProtectionGuard implements ContentPublishGuard {
    constructor(
        private readonly rules: ProtectionRuleRepository,
        private readonly approvals: ReviewApprovalRepository,
        private readonly heads: HeadRevisionQuery,
        private readonly permissions: PermissionsService,
        private readonly accessPolicy: AccessPolicy
    ) {}

    async check(context: ContentPublishGuardContext): Promise<PublishVerdict> {
        const { type, entryId, workspaceId, actor, bypass } = context;

        // Invariant I-02, and the reason it is the first thing here: an
        // installation with the plugin registered but no rule on this type must
        // pay for one indexed lookup and nothing else — no revision read, no
        // approval read, no permission resolution. A `null` rule and a
        // switched-off rule are the same state, exactly as the kernel reads
        // them.
        const rule = await this.rules.find(workspaceId, type.kind, type.name);
        if (!rule?.enabled) return { allowed: true };

        const head = await this.heads.find(type.name, entryId, workspaceId);
        // No revision means the entry is not reachable as this type in this
        // workspace. Content's own 404 owns that answer; refusing here would
        // turn a missing entry into a protection error and say more about what
        // exists than the caller is entitled to know.
        if (!head) return { allowed: true };

        const votes = await this.approvals.listForEntry(workspaceId, entryId);
        const isAdmin = await this.managesProtection(actor.userId);

        const decision = evaluateProtection({
            rule,
            headRevisionId: head.id,
            headAuthorId: head.authorId,
            approvals: votes,
            actor: {
                userId: actor.userId,
                isAdmin,
                isToken: actor.isToken
            }
        });

        if (decision.allowed) return { allowed: true };

        if (decision.reason === 'token-refused') {
            return {
                allowed: false,
                status: 409,
                code: PROTECTION_REFUSAL.TokenRefused,
                message: `Publishing "${type.name}" requires review, and an API token cannot be reviewed. Publish as a person, or allow token publishing on the rule.`
            };
        }

        // Short of approvals. A caller who did not ask to bypass is simply told
        // so; the rest of this is the bypass, which is the only way past.
        if (!bypass) {
            return this.insufficient(type.name, decision);
        }

        if (!decision.bypassable) {
            return {
                allowed: false,
                status: 403,
                code: PROTECTION_REFUSAL.BypassRefused,
                message: rule.adminBypass
                    ? 'Publishing past a review requirement needs the protection:manage permission.'
                    : `The rule on "${type.name}" allows no bypass.`
            };
        }

        // Allowed, and it says so out loud. The event rides content's own outbox
        // append, so the row that records this publish went past the rule
        // commits with it or not at all.
        return {
            allowed: true,
            events: [
                bypassEvent(entryId, {
                    contentType: type.name,
                    ruleId: rule.id,
                    required: decision.required,
                    given: decision.given
                })
            ]
        };
    }

    /** The refusal a blocked publish gets, with what the caller needs to act. */
    private insufficient(
        typeName: string,
        decision: {
            required: number;
            given: number;
            stale: number;
            bypassable: boolean;
        }
    ): PublishVerdict {
        return {
            allowed: false,
            status: 409,
            code: PROTECTION_REFUSAL.InsufficientApprovals,
            message: `Publishing "${typeName}" needs ${decision.required} approval(s) on the current version; it has ${decision.given}.`,
            details: {
                required: decision.required,
                given: decision.given,
                stale: decision.stale,
                bypassable: decision.bypassable
            }
        };
    }

    /**
     * Whether this principal administers protection — the kernel's `isAdmin`.
     *
     * The **`protection:manage` permission, not the `admin` role key**, which is
     * the same reading `EntryReviewService` uses to tell the panel a bypass is
     * available. If the two diverged, the editor would offer a button the API
     * then refused, which is the exact drift the whole feature is arranged to
     * avoid. `system-roles.ts` states the rule outright: the routes gate on the
     * permission, never on the role.
     *
     * A token has no user id and therefore no permissions — it was already
     * refused above, and answering `false` here keeps that true if the order
     * ever changes.
     */
    private async managesProtection(userId: string | null): Promise<boolean> {
        if (!userId) return false;
        const granted = await this.permissions.forUser(userId);
        return this.accessPolicy.can(
            { userId, grantedPermissions: new Set(granted) },
            Permission.create(PERMISSIONS.PROTECTION_MANAGE)
        );
    }
}
