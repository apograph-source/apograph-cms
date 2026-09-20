import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { FINDING_STATE, type FindingState } from '../domain/finding-state';
import {
    isAlarmSeverity,
    ALARM_SEVERITY,
    type AlarmSeverity
} from '../domain/alarm-severity';
import type {
    AlarmFindingListView,
    AlarmFindingView
} from '../types/alarm-views';
import { alarmFindings } from './schema/alarm-findings';
import { alarmRules } from './schema/alarm-rules';

/**
 * How many findings one statement writes at a time.
 *
 * Not a tuning knob — a correctness bound. A full rescan can match every row in
 * a collection, and Postgres accepts at most 65535 bind parameters per
 * statement; at eight columns per row a single insert of ~8000 findings is the
 * ceiling, past which the driver fails the whole reconciliation. Five hundred
 * leaves an order of magnitude of headroom and keeps each statement small
 * enough that a slow one is still interruptible.
 */
const WRITE_CHUNK = 500;

/** Splits `items` into runs of at most {@link WRITE_CHUNK}. */
function chunked<T>(items: readonly T[]): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += WRITE_CHUNK) {
        chunks.push(items.slice(i, i + WRITE_CHUNK));
    }
    return chunks;
}

/** What one reconciliation changed. */
export interface ReconcileResult {
    /** Findings that were absent or resolved and are now open. */
    opened: number;
    /** Findings that were open and are now resolved. */
    resolved: number;
}

/** Filters accepted by {@link AlarmFindingStore.list}. */
export interface ListFindingsFilter {
    state?: FindingState;
    ruleId?: string;
    severity?: AlarmSeverity;
    page: number;
    pageSize: number;
}

/**
 * Reads and writes findings.
 *
 * The one method that matters is {@link reconcile}: everything the evaluator
 * concludes goes through it, and it is written to be safe under at-least-once
 * delivery — the same event handled twice produces the same rows.
 */
@Injectable()
export class AlarmFindingStore {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /**
     * Brings the stored findings for one rule in line with a just-computed
     * verdict over a known set of entries.
     *
     * `matched` are the entries that match the rule now; `examined` is the set
     * the evaluation covered. Everything in `examined` that is not in `matched`
     * is resolved — which is how a finding closes itself with nobody pressing
     * anything. Entries outside `examined` are untouched, so an event-driven
     * pass over three rows cannot wipe a rule's other findings.
     *
     * Idempotency lives in the `ON CONFLICT` clause. `firstSeenAt` is written
     * only by the insert, so a re-delivered event refreshes `lastSeenAt` and
     * changes nothing else, and an entry that matches again comes back open
     * carrying the history it already had.
     */
    async reconcile(
        rule: { id: string; workspaceId: string; contentType: string },
        examined: readonly string[],
        matched: readonly string[],
        detailFor?: (entryId: string) => unknown
    ): Promise<ReconcileResult> {
        if (examined.length === 0) return { opened: 0, resolved: 0 };

        const matchedSet = new Set(matched);
        const stale = examined.filter((id) => !matchedSet.has(id));
        const now = new Date();

        let opened = 0;
        for (const batch of chunked([...matchedSet])) {
            const rows = batch.map((entryId) => ({
                ruleId: rule.id,
                entryId,
                workspaceId: rule.workspaceId,
                contentType: rule.contentType,
                state: FINDING_STATE.Open as FindingState,
                detail: detailFor?.(entryId) ?? null,
                firstSeenAt: now,
                lastSeenAt: now
            }));
            const written = await this.db
                .insert(alarmFindings)
                .values(rows)
                .onConflictDoUpdate({
                    target: [alarmFindings.ruleId, alarmFindings.entryId],
                    set: {
                        lastSeenAt: now,
                        resolvedAt: null,
                        detail: sql`excluded.detail`,
                        state: FINDING_STATE.Open
                    }
                })
                .returning({
                    entryId: alarmFindings.entryId,
                    firstSeenAt: alarmFindings.firstSeenAt,
                    state: alarmFindings.state
                });
            // "Newly open" is what a scan report should count — a finding that
            // was already open is not news. `firstSeenAt === now` identifies
            // the inserts; a re-opened one is counted by its resolvedAt having
            // been cleared, which the returning clause cannot see, so this
            // stays a deliberate under-count of re-opens rather than an
            // over-count of steady state.
            opened += written.filter(
                (row) =>
                    row.state === FINDING_STATE.Open &&
                    row.firstSeenAt.getTime() === now.getTime()
            ).length;
        }

        let resolved = 0;
        for (const batch of chunked(stale)) {
            const closed = await this.db
                .update(alarmFindings)
                .set({
                    state: FINDING_STATE.Resolved,
                    resolvedAt: now,
                    lastSeenAt: now
                })
                .where(
                    and(
                        eq(alarmFindings.ruleId, rule.id),
                        inArray(alarmFindings.entryId, batch),
                        ne(alarmFindings.state, FINDING_STATE.Resolved)
                    )
                )
                .returning({ entryId: alarmFindings.entryId });
            resolved += closed.length;
        }

        return { opened, resolved };
    }

    /**
     * Closes every finding on an entry, whatever rule produced it — what
     * `entry.deleted` means. Deliberately not a delete: a restore has to bring
     * the history back, and `firstSeenAt` is that history.
     */
    async resolveForEntry(entryId: string): Promise<void> {
        await this.db
            .update(alarmFindings)
            .set({ state: FINDING_STATE.Resolved, resolvedAt: new Date() })
            .where(
                and(
                    eq(alarmFindings.entryId, entryId),
                    ne(alarmFindings.state, FINDING_STATE.Resolved)
                )
            );
    }

    /**
     * Removes every finding on an entry — what `entry.purged` means. The row is
     * gone from its content table, so there is nothing left for a finding to
     * point at and nothing a restore could bring back.
     */
    async deleteForEntry(entryId: string): Promise<void> {
        await this.db
            .delete(alarmFindings)
            .where(eq(alarmFindings.entryId, entryId));
    }

    /** Entry ids this rule currently has a live (non-resolved) finding on. */
    async liveEntryIds(ruleId: string): Promise<string[]> {
        const rows = await this.db
            .select({ entryId: alarmFindings.entryId })
            .from(alarmFindings)
            .where(
                and(
                    eq(alarmFindings.ruleId, ruleId),
                    ne(alarmFindings.state, FINDING_STATE.Resolved)
                )
            );
        return rows.map((row) => row.entryId);
    }

    /** How many findings this rule currently has open. */
    async openCount(ruleId: string): Promise<number> {
        const [row] = await this.db
            .select({ total: count() })
            .from(alarmFindings)
            .where(
                and(
                    eq(alarmFindings.ruleId, ruleId),
                    eq(alarmFindings.state, FINDING_STATE.Open)
                )
            );
        return Number(row?.total ?? 0);
    }

    /**
     * The predicate behind both {@link list} and {@link severityCounts}.
     *
     * Resolved findings are history rather than a view, so they are excluded
     * unless asked for by name — stating that once, here, is what keeps the
     * list and the tally beside it talking about the same rows.
     */
    private findingsWhere(
        workspaceId: string,
        filter: Omit<ListFindingsFilter, 'page' | 'pageSize'>
    ) {
        return and(
            eq(alarmFindings.workspaceId, workspaceId),
            filter.state
                ? eq(alarmFindings.state, filter.state)
                : ne(alarmFindings.state, FINDING_STATE.Resolved),
            filter.ruleId ? eq(alarmFindings.ruleId, filter.ruleId) : undefined,
            filter.severity
                ? eq(alarmRules.severity, filter.severity)
                : undefined
        );
    }

    /** One page of a workspace's findings, joined to their rules. */
    async list(
        workspaceId: string,
        filter: ListFindingsFilter
    ): Promise<AlarmFindingListView> {
        const where = this.findingsWhere(workspaceId, filter);

        const [total] = await this.db
            .select({ total: count() })
            .from(alarmFindings)
            .innerJoin(alarmRules, eq(alarmRules.id, alarmFindings.ruleId))
            .where(where);

        const rows = await this.db
            .select({
                ruleId: alarmFindings.ruleId,
                entryId: alarmFindings.entryId,
                contentType: alarmFindings.contentType,
                state: alarmFindings.state,
                detail: alarmFindings.detail,
                firstSeenAt: alarmFindings.firstSeenAt,
                lastSeenAt: alarmFindings.lastSeenAt,
                ruleName: alarmRules.name,
                findingTitle: alarmRules.findingTitle,
                severity: alarmRules.severity
            })
            .from(alarmFindings)
            .innerJoin(alarmRules, eq(alarmRules.id, alarmFindings.ruleId))
            .where(where)
            .orderBy(desc(alarmFindings.lastSeenAt), alarmFindings.entryId)
            .limit(filter.pageSize)
            .offset((filter.page - 1) * filter.pageSize);

        return {
            items: rows.map(toView),
            total: Number(total?.total ?? 0),
            page: filter.page,
            pageSize: filter.pageSize
        };
    }

    /**
     * Live findings for a batch of entries, keyed by entry id.
     *
     * One query for a whole page of the records table — the alternative, a
     * request per row, is the N+1 the slot's `useRowsData` hook exists to
     * prevent.
     */
    async byEntryIds(
        workspaceId: string,
        entryIds: readonly string[]
    ): Promise<Record<string, AlarmFindingView[]>> {
        if (entryIds.length === 0) return {};
        const rows = await this.db
            .select({
                ruleId: alarmFindings.ruleId,
                entryId: alarmFindings.entryId,
                contentType: alarmFindings.contentType,
                state: alarmFindings.state,
                detail: alarmFindings.detail,
                firstSeenAt: alarmFindings.firstSeenAt,
                lastSeenAt: alarmFindings.lastSeenAt,
                ruleName: alarmRules.name,
                findingTitle: alarmRules.findingTitle,
                severity: alarmRules.severity
            })
            .from(alarmFindings)
            .innerJoin(alarmRules, eq(alarmRules.id, alarmFindings.ruleId))
            .where(
                and(
                    eq(alarmFindings.workspaceId, workspaceId),
                    inArray(alarmFindings.entryId, [...entryIds]),
                    ne(alarmFindings.state, FINDING_STATE.Resolved)
                )
            )
            .orderBy(alarmRules.name);

        const byEntry: Record<string, AlarmFindingView[]> = {};
        for (const row of rows) {
            (byEntry[row.entryId] ??= []).push(toView(row));
        }
        return byEntry;
    }

    /**
     * How the findings matching `filter` break down by severity.
     *
     * Shares the `where` builder with {@link list}, so the tally and the page
     * it accompanies can never describe different sets — the failure mode a
     * second hand-written predicate would eventually produce, and the one that
     * makes a summary worse than no summary.
     */
    async severityCounts(
        workspaceId: string,
        filter: Omit<ListFindingsFilter, 'page' | 'pageSize'> = {}
    ): Promise<Record<AlarmSeverity, number>> {
        const rows = await this.db
            .select({ severity: alarmRules.severity, total: count() })
            .from(alarmFindings)
            .innerJoin(alarmRules, eq(alarmRules.id, alarmFindings.ruleId))
            .where(this.findingsWhere(workspaceId, filter))
            .groupBy(alarmRules.severity);

        const counts: Record<AlarmSeverity, number> = {
            [ALARM_SEVERITY.Error]: 0,
            [ALARM_SEVERITY.Warn]: 0,
            [ALARM_SEVERITY.Info]: 0
        };
        for (const row of rows) {
            if (isAlarmSeverity(row.severity)) {
                counts[row.severity] = Number(row.total);
            }
        }
        return counts;
    }

    /** Open findings per severity for a workspace — the badge's counts. */
    openCountsBySeverity(
        workspaceId: string
    ): Promise<Record<AlarmSeverity, number>> {
        return this.severityCounts(workspaceId, {
            state: FINDING_STATE.Open
        });
    }
}

/** Joined row → wire view. */
function toView(row: {
    ruleId: string;
    entryId: string;
    contentType: string;
    state: string;
    detail: unknown;
    firstSeenAt: Date;
    lastSeenAt: Date;
    ruleName: string;
    findingTitle: string;
    severity: string;
}): AlarmFindingView {
    return {
        ruleId: row.ruleId,
        ruleName: row.ruleName,
        title: row.findingTitle,
        contentType: row.contentType,
        entryId: row.entryId,
        severity: isAlarmSeverity(row.severity)
            ? row.severity
            : ALARM_SEVERITY.Warn,
        state: row.state as FindingState,
        detail: row.detail,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString()
    };
}
