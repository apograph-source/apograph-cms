import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { UnitOfWork, type Database } from '@orthacms/database';
import type { ProtectionRuleView } from '../types/protection-views';
import { protectionRules } from './schema/protection-rules';

/** The six rule fields a write sets, plus who set them. */
export interface SaveProtectionRuleInput {
    enabled: boolean;
    requiredApprovals: number;
    requireOtherPerson: boolean;
    countStaleApprovals: boolean;
    adminBypass: boolean;
    allowTokenPublish: boolean;
    updatedBy: string | null;
}

/** One row as it comes back from Drizzle. */
type Row = typeof protectionRules.$inferSelect;

/**
 * Storage for protection rules.
 *
 * A plain Drizzle-backed service rather than a domain port with an adapter,
 * for the reason `AlarmRuleRepository` gives: this is a CRUD context whose only
 * invariant — one rule per `(workspace, kind, slug)` — is a database index, and
 * ADR-0003 is explicit that a thin context gets mappers, not an aggregate and a
 * repository interface with one implementation.
 *
 * The **decision** the rules feed lives in `@orthacms/protection-domain` and is
 * not re-implemented here; this class only stores and reads.
 */
@Injectable()
export class ProtectionRuleRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /**
     * The executor to run against: the ambient transaction when a caller opened
     * one, the base connection otherwise. It exists so a rule write and the
     * event describing it can commit together once events land.
     */
    private get exec(): Database {
        return this.uow.current();
    }

    /** Every rule in the workspace, however addressed. */
    async list(workspaceId: string): Promise<ProtectionRuleView[]> {
        const rows = await this.exec
            .select()
            .from(protectionRules)
            .where(eq(protectionRules.workspaceId, workspaceId));
        return rows.map(toView);
    }

    /** One rule, or `null` when the type is unprotected. */
    async find(
        workspaceId: string,
        kind: string,
        slug: string
    ): Promise<ProtectionRuleView | null> {
        const [row] = await this.exec
            .select()
            .from(protectionRules)
            .where(address(workspaceId, kind, slug))
            .limit(1);
        return row ? toView(row) : null;
    }

    /**
     * Writes the rule for one type, inserting or replacing it.
     *
     * `onConflictDoUpdate` against the unique index rather than a read followed
     * by a write: two administrators saving the same tab at once would both
     * find no row and both insert, and the second would fail on the constraint
     * with a 500. The database already knows how to arbitrate this, so it does.
     */
    async save(
        workspaceId: string,
        kind: string,
        slug: string,
        input: SaveProtectionRuleInput
    ): Promise<ProtectionRuleView> {
        const values = {
            workspaceId,
            kind,
            slug,
            enabled: input.enabled,
            requiredApprovals: input.requiredApprovals,
            requireOtherPerson: input.requireOtherPerson,
            countStaleApprovals: input.countStaleApprovals,
            adminBypass: input.adminBypass,
            allowTokenPublish: input.allowTokenPublish,
            updatedBy: input.updatedBy
        };
        const [row] = await this.exec
            .insert(protectionRules)
            .values(values)
            .onConflictDoUpdate({
                target: [
                    protectionRules.workspaceId,
                    protectionRules.kind,
                    protectionRules.slug
                ],
                set: {
                    enabled: values.enabled,
                    requiredApprovals: values.requiredApprovals,
                    requireOtherPerson: values.requireOtherPerson,
                    countStaleApprovals: values.countStaleApprovals,
                    adminBypass: values.adminBypass,
                    allowTokenPublish: values.allowTokenPublish,
                    updatedBy: values.updatedBy,
                    updatedAt: new Date()
                }
            })
            .returning();
        return toView(row);
    }

    /**
     * Removes the rule for one type. Reports whether a row was there.
     *
     * Deleting a rule that does not exist is not an error — the caller asked
     * for the type to be unprotected and it is. The boolean is for the audit
     * trail, so a no-op delete does not later look like a policy change.
     */
    async remove(
        workspaceId: string,
        kind: string,
        slug: string
    ): Promise<boolean> {
        const removed = await this.exec
            .delete(protectionRules)
            .where(address(workspaceId, kind, slug))
            .returning({ id: protectionRules.id });
        return removed.length > 0;
    }
}

/** The `(workspace, kind, slug)` coordinate, as a predicate. */
function address(workspaceId: string, kind: string, slug: string) {
    return and(
        eq(protectionRules.workspaceId, workspaceId),
        eq(protectionRules.kind, kind),
        eq(protectionRules.slug, slug)
    );
}

/** Row → the view the API answers with. */
function toView(row: Row): ProtectionRuleView {
    return {
        id: row.id,
        kind: row.kind,
        slug: row.slug,
        enabled: row.enabled,
        requiredApprovals: row.requiredApprovals,
        requireOtherPerson: row.requireOtherPerson,
        countStaleApprovals: row.countStaleApprovals,
        adminBypass: row.adminBypass,
        allowTokenPublish: row.allowTokenPublish,
        updatedBy: row.updatedBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
    };
}
