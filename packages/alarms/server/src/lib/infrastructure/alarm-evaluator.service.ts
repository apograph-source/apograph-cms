import { Injectable, Logger } from '@nestjs/common';
import {
    CONTENT_FIELD_TYPE,
    EntryMatchQuery,
    InjectContentRegistry,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { FilterException } from '@orthacms/utils-server';
import { InjectAlarmsConfig } from '../alarms.tokens';
import type { ResolvedAlarmsConfig } from '../types/alarms-config';
import type { AlarmScanResultView } from '../types/alarm-views';
import {
    AlarmRuleRepository,
    type AlarmRuleRecord
} from './alarm-rule.repository';
import { AlarmFindingStore } from './alarm-finding.store';

/**
 * Runs rules against content.
 *
 * Every path through this class ends in the same place — `EntryMatchQuery`,
 * content's own filter evaluation — so a rule means exactly what the records
 * list means by the same filter. What differs between the paths is only *which
 * rows* are examined:
 *
 * | trigger              | examined                                      |
 * | -------------------- | --------------------------------------------- |
 * | an entry was written | that entry, against every rule of its type    |
 * | an entry went live   | ...plus the entries whose rules traverse to it |
 * | a rescan             | the whole collection, against one rule        |
 *
 * The middle row is the non-obvious one and the reason findings close by
 * themselves. "This published article links to a draft author" is a fact about
 * the *article*, but the event that fixes it arrives about the **author**. So
 * publishing an author re-evaluates the articles whose rules traverse an author
 * relation — the same rule, ANDed with `author.id = <the author>`, which is
 * expressible because the stored filter is a tree we can compose rather than a
 * string we would have to re-parse.
 */
@Injectable()
export class AlarmEvaluator {
    private readonly logger = new Logger(AlarmEvaluator.name);

    constructor(
        private readonly rules: AlarmRuleRepository,
        private readonly findings: AlarmFindingStore,
        private readonly matches: EntryMatchQuery,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @InjectAlarmsConfig() private readonly config: ResolvedAlarmsConfig
    ) {}

    /**
     * Evaluates one or more entries of one type against every active rule for
     * that type. This is the event path: cheap, point-checked, and safe to run
     * on every write.
     */
    async evaluateEntries(
        workspaceId: string,
        contentType: string,
        entryIds: readonly string[]
    ): Promise<void> {
        if (entryIds.length === 0) return;
        const type = this.registry.get(contentType);
        if (!type) return;

        const rules = await this.rules.activeForType(workspaceId, contentType);
        for (const rule of rules) {
            await this.evaluateAgainst(rule, type, entryIds);
        }
    }

    /**
     * Re-evaluates the entries that point at `changedEntryId`, for the rules
     * whose filters traverse a relation to `changedType`.
     *
     * Bounded twice over: only rules that actually mention such a relation are
     * considered, and each is asked about at most `maxDependentsPerEvent`
     * entries. A workspace with no relation-traversing rules pays one indexed
     * query for the whole pass.
     */
    async evaluateDependents(
        workspaceId: string,
        changedType: string,
        changedEntryId: string
    ): Promise<void> {
        const candidates = await this.rules.byTraversedType(
            workspaceId,
            new Set([changedType]),
            (contentType) => this.relationTargets(contentType)
        );

        for (const { rule, relationField } of candidates) {
            const type = this.registry.get(rule.contentType);
            if (!type) continue;

            // Entries that link to the changed one AND are currently flagged by
            // this rule — the set whose findings may need closing — plus those
            // that link to it and match now. Both are answered by the same
            // composed filter; the union is what gets reconciled, so an entry
            // that started matching opens a finding and one that stopped
            // matching closes it, in one pass.
            const linked = await this.safeMatch(
                rule,
                type,
                {
                    and: [
                        {
                            field: `${relationField}.id`,
                            op: 'eq',
                            value: changedEntryId
                        }
                    ]
                },
                undefined,
                this.config.maxDependentsPerEvent
            );
            if (linked === null) continue;

            // The flagged set is bounded too: a rule with thousands of open
            // findings must not turn one publish into a full reconciliation.
            // The remainder is picked up by the next rescan or sweep.
            const flagged = (await this.findings.liveEntryIds(rule.id)).slice(
                0,
                this.config.maxDependentsPerEvent
            );
            const examined = [...new Set([...linked, ...flagged])];
            if (examined.length === 0) continue;

            const matched = await this.safeMatch(
                rule,
                type,
                rule.filter,
                examined
            );
            if (matched === null) continue;
            await this.findings.reconcile(rule, examined, matched);
        }
    }

    /**
     * Re-runs one rule over its whole collection.
     *
     * The examined set is the union of every entry the collection holds (up to
     * the configured ceiling) and every entry the rule currently flags. The
     * second half matters: an entry that has since been filtered out of the
     * scan window — or trashed — still has a finding, and a scan that only
     * looked at the window would leave it open forever.
     */
    async rescan(rule: AlarmRuleRecord): Promise<AlarmScanResultView> {
        const type = this.registry.get(rule.contentType);
        if (!type) {
            await this.rules.markBroken(
                rule.id,
                `Content type "${rule.contentType}" is not registered.`
            );
            return {
                ruleId: rule.id,
                scanned: 0,
                opened: 0,
                resolved: 0,
                open: 0
            };
        }

        const examined: string[] = [];
        const matched: string[] = [];
        const batch = this.config.scanBatchSize;

        for (
            let offset = 0;
            offset < this.config.maxScanEntries;
            offset += batch
        ) {
            const page = await this.matches.matchingIds(
                type,
                // An empty tree means "no predicate", which is how the scan
                // enumerates the collection through the very same query it uses
                // to test it — one code path, one notion of which rows exist.
                {},
                rule.workspaceId,
                {
                    limit: Math.min(batch, this.config.maxScanEntries - offset),
                    offset
                }
            );
            if (page.length === 0) break;
            examined.push(...page);

            const hits = await this.safeMatch(rule, type, rule.filter, page);
            if (hits === null) {
                return {
                    ruleId: rule.id,
                    scanned: examined.length,
                    opened: 0,
                    resolved: 0,
                    open: await this.findings.openCount(rule.id)
                };
            }
            matched.push(...hits);
            if (page.length < batch) break;
        }

        if (examined.length >= this.config.maxScanEntries) {
            // Say so rather than reporting a clean scan of a truncated set: a
            // correctness tool that silently stops looking is worse than one
            // that admits it.
            this.logger.warn(
                `Rule "${rule.name}" hit the ${this.config.maxScanEntries}-entry scan ceiling; ` +
                    'findings beyond it were not refreshed.'
            );
        }

        // Entries the rule already flags but the scan window missed — trashed
        // rows, or rows past the ceiling. Adding them to `examined` without
        // adding them to `matched` is exactly what closes them.
        const flagged = await this.findings.liveEntryIds(rule.id);
        const seen = new Set(examined);
        const outsideWindow = flagged.filter((id) => !seen.has(id));
        const fullExamined = [...examined, ...outsideWindow];

        const result = await this.findings.reconcile(
            rule,
            fullExamined,
            matched
        );
        await this.rules.markScanned(rule.id, new Date());

        return {
            ruleId: rule.id,
            scanned: examined.length,
            opened: result.opened,
            resolved: result.resolved,
            open: await this.findings.openCount(rule.id)
        };
    }

    /** Point-checks `entryIds` against one rule and reconciles the verdict. */
    private async evaluateAgainst(
        rule: AlarmRuleRecord,
        type: AnyContentType,
        entryIds: readonly string[]
    ): Promise<void> {
        const matched = await this.safeMatch(rule, type, rule.filter, entryIds);
        if (matched === null) return;
        await this.findings.reconcile(rule, entryIds, matched);
    }

    /**
     * Runs a filter, turning a parse failure into "this rule is broken" rather
     * than an exception in a background subscriber.
     *
     * Returns `null` when the rule could not be evaluated, so callers skip it
     * instead of concluding "nothing matched" — which would resolve every one
     * of its findings on the way to reporting success.
     */
    private async safeMatch(
        rule: AlarmRuleRecord,
        type: AnyContentType,
        filter: unknown,
        entryIds?: readonly string[],
        limit?: number
    ): Promise<string[] | null> {
        try {
            return await this.matches.matchingIds(
                type,
                filter,
                rule.workspaceId,
                { entryIds, limit }
            );
        } catch (error) {
            if (error instanceof FilterException) {
                await this.rules.markBroken(rule.id, error.message);
                this.logger.warn(
                    `Rule "${rule.name}" (${rule.id}) no longer parses against ` +
                        `"${rule.contentType}" and was marked broken: ${error.message}`
                );
                return null;
            }
            throw error;
        }
    }

    /**
     * A type's relation fields mapped to the type they point at — how a rule's
     * `author.status` leaf is recognised as a traversal into `author`.
     */
    private relationTargets(contentType: string): Map<string, string> {
        const type = this.registry.get(contentType);
        const targets = new Map<string, string>();
        if (!type) return targets;
        for (const [name, spec] of Object.entries(type.fields)) {
            if (spec.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation) {
                continue;
            }
            targets.set(name, spec.relation.to().name);
        }
        return targets;
    }
}
