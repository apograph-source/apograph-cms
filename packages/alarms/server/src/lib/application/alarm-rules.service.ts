import { Injectable } from '@nestjs/common';
import {
    attachActor,
    OutboxWriter,
    UnitOfWork,
    type EventActor
} from '@orthacms/database';
import {
    EntryMatchQuery,
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import {
    AlarmRuleNotFoundError,
    UnknownAlarmContentTypeError
} from '../domain/errors';
import { ALARM_EVENT_KINDS, alarmRuleEvent } from '../alarms.events';
import { AlarmEvaluator } from '../infrastructure/alarm-evaluator.service';
import { AlarmRuleRepository } from '../infrastructure/alarm-rule.repository';
import type { AlarmRuleRecord } from '../infrastructure/alarm-rule.repository';
import type {
    AlarmRulePreviewView,
    AlarmRuleView,
    AlarmScanResultView
} from '../types/alarm-views';
import { PREVIEW_SAMPLE_SIZE } from '../alarms.constants';
import type {
    CreateAlarmRuleDto,
    PreviewAlarmRuleDto,
    UpdateAlarmRuleDto
} from './dto/save-alarm-rule.dto';

/**
 * The rule lifecycle: create, edit, delete, preview, rescan.
 *
 * Two things happen here that could not sit in the repository, and both are the
 * point of the layer:
 *
 * 1. **A filter is parsed before it is stored.** A rule is replayed by a
 *    background subscriber for months; a tree that only fails at evaluation
 *    time fails where nobody is looking. So every write runs it through the
 *    same `parseFilterTree` the records list does, and a malformed one is a 400
 *    at the moment it is written.
 * 2. **Editing a filter forces a rescan.** Without it the findings table keeps
 *    describing the *previous* condition and states it with total confidence —
 *    the worst failure mode available to a tool whose only product is trust.
 */
@Injectable()
export class AlarmRulesService {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly rules: AlarmRuleRepository,
        private readonly evaluator: AlarmEvaluator,
        private readonly matches: EntryMatchQuery,
        private readonly grants: WorkspaceGrantsQuery,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry
    ) {}

    /**
     * Appends one `alarm.rule.*` event from inside the active unit of work.
     *
     * `workspaceId` rides in the payload because that is where the audit row
     * reads its own `workspace_id` from — an alarm rule always belongs to one,
     * so these are among the rows the column exists to make findable.
     */
    private async emit(
        kind: string,
        ruleId: string,
        payload: Record<string, unknown>,
        actor?: EventActor
    ): Promise<void> {
        const event = alarmRuleEvent(kind, ruleId, payload);
        await this.outbox.append(actor ? attachActor([event], actor) : [event]);
    }

    /** Every rule in the workspace, with its live counts. */
    list(workspaceId: string): Promise<AlarmRuleView[]> {
        return this.rules.listWithCounts(workspaceId);
    }

    /**
     * Creates a rule and immediately scans the collection with it.
     *
     * The scan is not an optimisation — it is what makes a new rule mean
     * anything. Without it the rule would only ever see entries that happen to
     * be edited later, so it would report a clean collection on the day it was
     * written precisely when it is most likely to be wrong.
     */
    async create(
        workspaceId: string,
        actorId: string | null,
        dto: CreateAlarmRuleDto,
        actor?: EventActor
    ): Promise<{ rule: AlarmRuleView; scan: AlarmScanResultView }> {
        const type = await this.resolveType(workspaceId, dto.contentType);
        this.matches.assertParses(type, dto.filter, workspaceId);

        // The rule row and its event, and nothing else. The scan below reads
        // the whole collection, and holding a transaction open across it would
        // pay for an audit row with a long lock on the content tables.
        const created = await this.uow.run(async () => {
            const row = await this.rules.create({
                workspaceId,
                contentType: dto.contentType,
                name: dto.name,
                findingTitle: dto.findingTitle,
                description: dto.description ?? null,
                severity: dto.severity,
                filter: dto.filter,
                enabled: dto.enabled,
                createdBy: actorId
            });
            await this.emit(
                ALARM_EVENT_KINDS.RULE_CREATED,
                row.id,
                {
                    workspaceId,
                    name: row.name,
                    contentType: row.contentType,
                    severity: row.severity,
                    enabled: row.enabled
                },
                actor
            );
            return row;
        });

        const scan = await this.evaluator.rescan(created);
        return { rule: await this.viewOf(workspaceId, created.id), scan };
    }

    /**
     * Applies a partial update. A changed filter is validated and then rescanned
     * before the call returns, so the response never describes a rule whose
     * findings belong to its previous condition.
     */
    async update(
        workspaceId: string,
        ruleId: string,
        dto: UpdateAlarmRuleDto,
        actor?: EventActor
    ): Promise<AlarmRuleView> {
        const existing = await this.rules.findOrFail(workspaceId, ruleId);
        if (dto.filter !== undefined) {
            const type = await this.resolveType(
                workspaceId,
                existing.contentType
            );
            this.matches.assertParses(type, dto.filter, workspaceId);
        }

        const updated = await this.uow.run(async () => {
            const row = await this.rules.update(workspaceId, ruleId, dto);
            await this.emit(
                ALARM_EVENT_KINDS.RULE_UPDATED,
                ruleId,
                {
                    workspaceId,
                    name: row.name,
                    contentType: row.contentType,
                    // The keys the caller actually sent — a partial update, so
                    // "what changed" is the request rather than the row.
                    fields: Object.keys(dto),
                    // Called out on its own because a disabled rule is
                    // indistinguishable from one that finds nothing, and this
                    // is the only record that somebody chose the silence.
                    enabled: { from: existing.enabled, to: row.enabled },
                    severity: { from: existing.severity, to: row.severity }
                },
                actor
            );
            return row;
        });
        if (dto.filter !== undefined && updated.enabled) {
            await this.evaluator.rescan(updated);
        }
        return this.viewOf(workspaceId, ruleId);
    }

    /** Deletes a rule. Its findings go with it, by FK cascade. */
    async remove(
        workspaceId: string,
        ruleId: string,
        actor?: EventActor
    ): Promise<void> {
        const existing = await this.rules.findOrFail(workspaceId, ruleId);
        await this.uow.run(async () => {
            await this.rules.remove(workspaceId, ruleId);
            // The rule's own details, because after this commits there is
            // nowhere left to look them up — and every finding it produced
            // disappeared with it.
            await this.emit(
                ALARM_EVENT_KINDS.RULE_DELETED,
                ruleId,
                {
                    workspaceId,
                    name: existing.name,
                    contentType: existing.contentType,
                    severity: existing.severity
                },
                actor
            );
        });
    }

    /** Re-runs one rule over its whole collection. */
    async rescan(
        workspaceId: string,
        ruleId: string,
        actor?: EventActor
    ): Promise<AlarmScanResultView> {
        const rule = await this.rules.findOrFail(workspaceId, ruleId);
        const scan = await this.evaluator.rescan(rule);
        // Recorded **after** the scan, and carrying its result: this is the
        // manual recovery path, so a row here is what explains a jump in a
        // workspace's finding counts that no rule edit accounts for.
        await this.uow.run(() =>
            this.emit(
                ALARM_EVENT_KINDS.RULE_RESCANNED,
                ruleId,
                {
                    workspaceId,
                    name: rule.name,
                    contentType: rule.contentType,
                    scanned: scan.scanned,
                    opened: scan.opened,
                    resolved: scan.resolved,
                    open: scan.open
                },
                actor
            )
        );
        return scan;
    }

    /**
     * How many entries a candidate filter matches, out of how many exist.
     *
     * The denominator is the half that makes the number a judgement rather than
     * a statistic: "14 matches" says nothing, "14 of 312" says the rule is
     * probably about right and "298 of 312" says it is inverted.
     */
    async preview(
        workspaceId: string,
        dto: PreviewAlarmRuleDto
    ): Promise<AlarmRulePreviewView> {
        const type = await this.resolveType(workspaceId, dto.contentType);
        const [matched, total, sampleIds] = await Promise.all([
            this.matches.countMatching(type, dto.filter, workspaceId),
            this.matches.countAll(type, workspaceId),
            this.matches.matchingIds(type, dto.filter, workspaceId, {
                limit: PREVIEW_SAMPLE_SIZE
            })
        ]);
        return { matched, total, sampleIds };
    }

    /** One rule's current view, after a write. */
    private async viewOf(
        workspaceId: string,
        ruleId: string
    ): Promise<AlarmRuleView> {
        const all = await this.rules.listWithCounts(workspaceId);
        const view = all.find((rule) => rule.id === ruleId);
        if (!view) throw new AlarmRuleNotFoundError(ruleId);
        return view;
    }

    /**
     * Resolves a content type the workspace may actually reach.
     *
     * An unregistered name and an ungranted one give the **same** error, which
     * is content's own rule (`resolveGrantedType`): distinguishing them would
     * let a workspace enumerate the deployment's content model through the
     * rule editor.
     */
    private async resolveType(
        workspaceId: string,
        contentType: string
    ): Promise<AnyContentType> {
        const granted = await this.grants.grantedSlugs(workspaceId);
        const type = this.registry.get(contentType);
        if (!type || !granted.has(contentType)) {
            throw new UnknownAlarmContentTypeError(contentType);
        }
        return type;
    }
}

export type { AlarmRuleRecord };
