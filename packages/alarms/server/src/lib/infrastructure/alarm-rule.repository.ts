import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork, type Database } from '@orthacms/database';
import { isUniqueViolation } from '@orthacms/utils-server';
import { AlarmRuleNotFoundError } from '../domain/errors';
import { filterTreeSegments } from '../domain/filter-tree-segments';
import { FINDING_STATE } from '../domain/finding-state';
import {
    isAlarmSeverity,
    ALARM_SEVERITY,
    type AlarmSeverity
} from '../domain/alarm-severity';
import type { AlarmRuleView } from '../types/alarm-views';
import { alarmFindings } from './schema/alarm-findings';
import { alarmRules } from './schema/alarm-rules';

/** One stored rule, as the evaluator needs it. */
export interface AlarmRuleRecord {
    id: string;
    workspaceId: string;
    contentType: string;
    name: string;
    findingTitle: string;
    severity: AlarmSeverity;
    filter: unknown;
    enabled: boolean;
    brokenReason: string | null;
}

/** Fields a create accepts. */
export interface CreateAlarmRuleInput {
    workspaceId: string;
    contentType: string;
    name: string;
    findingTitle: string;
    description?: string | null;
    severity: AlarmSeverity;
    filter: unknown;
    enabled?: boolean;
    createdBy: string | null;
}

/** Fields an update may change — every one optional, PATCH semantics. */
export interface UpdateAlarmRuleInput {
    name?: string;
    findingTitle?: string;
    description?: string | null;
    severity?: AlarmSeverity;
    filter?: unknown;
    enabled?: boolean;
}

/** Thrown when a workspace already has a rule under this name. */
export class DuplicateAlarmRuleNameError extends Error {
    constructor(readonly ruleName: string) {
        super(`A rule named "${ruleName}" already exists in this workspace.`);
        this.name = 'DuplicateAlarmRuleNameError';
    }
}

/**
 * Storage for alarm rules.
 *
 * A plain Drizzle-backed service rather than a domain port with an adapter:
 * this is a CRUD context whose only invariant (name uniqueness per workspace)
 * is a database index. ADR-0003 is explicit that a thin context gets mappers
 * and projections, not an aggregate and a repository interface it would only
 * ever have one implementation of.
 */
@Injectable()
export class AlarmRuleRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /**
     * The executor to run against: the ambient transaction when a caller opened
     * one, the base connection otherwise.
     *
     * It exists so a rule write and the `alarm.rule.*` event describing it
     * commit together. Outside a unit of work this is exactly the old
     * behaviour — `UnitOfWork.current()` falls back to the pool — so no caller
     * had to change.
     */
    private get exec(): Database {
        return this.uow.current();
    }

    /** Every enabled, non-broken rule for one content type in one workspace. */
    async activeForType(
        workspaceId: string,
        contentType: string
    ): Promise<AlarmRuleRecord[]> {
        const rows = await this.exec
            .select()
            .from(alarmRules)
            .where(
                and(
                    eq(alarmRules.workspaceId, workspaceId),
                    eq(alarmRules.contentType, contentType),
                    eq(alarmRules.enabled, true),
                    // A broken rule is skipped rather than retried on every
                    // save: its filter cannot parse, so every evaluation would
                    // throw in a background subscriber where nobody sees it.
                    sql`${alarmRules.brokenReason} is null`
                )
            );
        return rows.map(toRecord);
    }

    /** Every enabled, non-broken rule across all workspaces — the sweep's input. */
    async allActive(): Promise<AlarmRuleRecord[]> {
        const rows = await this.exec
            .select()
            .from(alarmRules)
            .where(
                and(
                    eq(alarmRules.enabled, true),
                    sql`${alarmRules.brokenReason} is null`
                )
            );
        return rows.map(toRecord);
    }

    /**
     * Enabled rules in this workspace whose filter tree mentions `relationName`
     * as a first path segment — the candidates for the reverse pass that runs
     * when the entry those rules traverse *to* changes.
     *
     * The match is done in TypeScript over the stored tree rather than in SQL:
     * a jsonb containment query cannot express "any leaf whose `field` starts
     * with this segment" without an index this table does not want, and the
     * rule set of one workspace is small enough to walk.
     */
    async byTraversedType(
        workspaceId: string,
        targetTypes: ReadonlySet<string>,
        relationsOf: (contentType: string) => Map<string, string>
    ): Promise<Array<{ rule: AlarmRuleRecord; relationField: string }>> {
        if (targetTypes.size === 0) return [];
        const rows = await this.exec
            .select()
            .from(alarmRules)
            .where(
                and(
                    eq(alarmRules.workspaceId, workspaceId),
                    eq(alarmRules.enabled, true),
                    sql`${alarmRules.brokenReason} is null`
                )
            );

        const found: Array<{ rule: AlarmRuleRecord; relationField: string }> =
            [];
        for (const row of rows) {
            const rule = toRecord(row);
            const relations = relationsOf(rule.contentType);
            if (relations.size === 0) continue;
            for (const segment of filterTreeSegments(rule.filter)) {
                const target = relations.get(segment);
                if (target && targetTypes.has(target)) {
                    found.push({ rule, relationField: segment });
                    break;
                }
            }
        }
        return found;
    }

    /** One rule by id, scoped to its workspace. */
    async find(
        workspaceId: string,
        ruleId: string
    ): Promise<AlarmRuleRecord | null> {
        const [row] = await this.exec
            .select()
            .from(alarmRules)
            .where(
                and(
                    eq(alarmRules.workspaceId, workspaceId),
                    eq(alarmRules.id, ruleId)
                )
            )
            .limit(1);
        return row ? toRecord(row) : null;
    }

    /** One rule by id, or {@link AlarmRuleNotFoundError}. */
    async findOrFail(
        workspaceId: string,
        ruleId: string
    ): Promise<AlarmRuleRecord> {
        const rule = await this.find(workspaceId, ruleId);
        if (!rule) throw new AlarmRuleNotFoundError(ruleId);
        return rule;
    }

    /** Inserts a rule, translating the unique index into a domain error. */
    async create(input: CreateAlarmRuleInput): Promise<AlarmRuleRecord> {
        try {
            const [row] = await this.exec
                .insert(alarmRules)
                .values({
                    workspaceId: input.workspaceId,
                    contentType: input.contentType,
                    name: input.name,
                    findingTitle: input.findingTitle,
                    description: input.description ?? null,
                    severity: input.severity,
                    filter: input.filter,
                    enabled: input.enabled ?? true,
                    createdBy: input.createdBy
                })
                .returning();
            return toRecord(row);
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new DuplicateAlarmRuleNameError(input.name);
            }
            throw error;
        }
    }

    /** Applies a partial update. Absent keys are left alone. */
    async update(
        workspaceId: string,
        ruleId: string,
        input: UpdateAlarmRuleInput
    ): Promise<AlarmRuleRecord> {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (input.name !== undefined) patch['name'] = input.name;
        if (input.findingTitle !== undefined)
            patch['findingTitle'] = input.findingTitle;
        if (input.description !== undefined)
            patch['description'] = input.description;
        if (input.severity !== undefined) patch['severity'] = input.severity;
        if (input.enabled !== undefined) patch['enabled'] = input.enabled;
        if (input.filter !== undefined) {
            patch['filter'] = input.filter;
            // A filter that has just been validated is by definition no longer
            // broken; leaving the flag set would keep the rule skipped forever
            // after the very edit that fixed it.
            patch['brokenReason'] = null;
        }

        try {
            const [row] = await this.exec
                .update(alarmRules)
                .set(patch)
                .where(
                    and(
                        eq(alarmRules.workspaceId, workspaceId),
                        eq(alarmRules.id, ruleId)
                    )
                )
                .returning();
            if (!row) throw new AlarmRuleNotFoundError(ruleId);
            return toRecord(row);
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new DuplicateAlarmRuleNameError(input.name ?? '');
            }
            throw error;
        }
    }

    /** Deletes a rule; its findings go with it by FK cascade. */
    async remove(workspaceId: string, ruleId: string): Promise<void> {
        const [row] = await this.exec
            .delete(alarmRules)
            .where(
                and(
                    eq(alarmRules.workspaceId, workspaceId),
                    eq(alarmRules.id, ruleId)
                )
            )
            .returning({ id: alarmRules.id });
        if (!row) throw new AlarmRuleNotFoundError(ruleId);
    }

    /**
     * Records that a rule's stored filter stopped parsing, so the UI can say so
     * and the evaluator can stop trying. Idempotent: re-marking with the same
     * reason writes the same row.
     */
    async markBroken(ruleId: string, reason: string): Promise<void> {
        await this.exec
            .update(alarmRules)
            .set({ brokenReason: reason })
            .where(eq(alarmRules.id, ruleId));
    }

    /** Stamps the end of a successful full rescan. */
    async markScanned(ruleId: string, at: Date): Promise<void> {
        await this.exec
            .update(alarmRules)
            .set({ lastScanAt: at })
            .where(eq(alarmRules.id, ruleId));
    }

    /**
     * Every rule in a workspace, with its live open count — the alarms
     * page's list.
     *
     * The counts come from one grouped query over `alarm_findings` rather than
     * a count per rule: a workspace with twenty rules would otherwise issue
     * forty queries to render one list.
     */
    async listWithCounts(workspaceId: string): Promise<AlarmRuleView[]> {
        const rows = await this.exec
            .select()
            .from(alarmRules)
            .where(eq(alarmRules.workspaceId, workspaceId))
            .orderBy(alarmRules.name);
        if (rows.length === 0) return [];

        const counts = await this.exec
            .select({ ruleId: alarmFindings.ruleId, total: count() })
            .from(alarmFindings)
            .where(
                and(
                    eq(alarmFindings.workspaceId, workspaceId),
                    inArray(
                        alarmFindings.ruleId,
                        rows.map((row) => row.id)
                    ),
                    eq(alarmFindings.state, FINDING_STATE.Open)
                )
            )
            .groupBy(alarmFindings.ruleId);

        const open = new Map<string, number>(
            counts.map((row) => [row.ruleId, Number(row.total)])
        );

        return rows.map((row) => ({
            id: row.id,
            contentType: row.contentType,
            name: row.name,
            findingTitle: row.findingTitle,
            description: row.description,
            severity: coerceSeverity(row.severity),
            filter: row.filter,
            enabled: row.enabled,
            brokenReason: row.brokenReason,
            lastScanAt: row.lastScanAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            openCount: open.get(row.id) ?? 0
        }));
    }
}

/** Row → the shape the evaluator works with. */
function toRecord(row: typeof alarmRules.$inferSelect): AlarmRuleRecord {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        contentType: row.contentType,
        name: row.name,
        findingTitle: row.findingTitle,
        severity: coerceSeverity(row.severity),
        filter: row.filter,
        enabled: row.enabled,
        brokenReason: row.brokenReason
    };
}

/**
 * A stored severity that is not one of ours reads as `warn`.
 *
 * The column is text rather than an enum (adding a severity should not be a
 * migration), so an unknown value is reachable — from a hand-edited row, or
 * from a downgrade. Falling back to the middle severity keeps the rule visible
 * and honest; the alternative, throwing, would take the whole alarms page down
 * for one bad row.
 */
function coerceSeverity(value: string): AlarmSeverity {
    return isAlarmSeverity(value) ? value : ALARM_SEVERITY.Warn;
}
