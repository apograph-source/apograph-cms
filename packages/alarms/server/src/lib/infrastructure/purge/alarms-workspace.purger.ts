import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import { alarmFindings } from '../schema/alarm-findings';
import { alarmRules } from '../schema/alarm-rules';

/**
 * Removes a deleted workspace's alarm rules and findings.
 *
 * Both tables carry a plain `workspace_id` with no foreign key — this plugin
 * holds no cross-plugin FK, the same rule `media` and `api_token_workspaces`
 * follow — so nothing removed them and a delete left them behind. That is worse
 * here than for most scoping rows, because a rule is not inert: the periodic
 * sweep reads {@link AlarmRuleRepository.allActive} without asking whether the
 * workspace still exists, so an orphaned rule is re-evaluated on every pass,
 * forever, while being unreachable from the UI — the rule editor lives inside
 * the workspace that no longer opens.
 *
 * Findings are deleted explicitly rather than left to the `rule_id` cascade.
 * The cascade would cover them, but the count this returns is what the delete
 * reports and the logs record, and "removed 12 rules" reads very differently
 * from "removed 12 rules and 4 000 findings".
 */
@Injectable()
export class AlarmsWorkspacePurger implements WorkspacePurger, OnModuleInit {
    readonly purgeName = 'alarms:rules-and-findings';

    constructor(
        private readonly uow: UnitOfWork,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const db = this.uow.current();

        // Findings first: once the rules are gone the cascade has already taken
        // them, and this delete would report zero for rows it did remove.
        const findings = await db
            .delete(alarmFindings)
            .where(eq(alarmFindings.workspaceId, workspaceId))
            .returning({ ruleId: alarmFindings.ruleId });
        const rules = await db
            .delete(alarmRules)
            .where(eq(alarmRules.workspaceId, workspaceId))
            .returning({ id: alarmRules.id });

        return { rows: findings.length + rules.length };
    }
}
