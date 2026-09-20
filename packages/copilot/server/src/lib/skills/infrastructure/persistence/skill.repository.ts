import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { UnitOfWork, type Database } from '@orthacms/database';
import type { Skill, SkillMode } from '@orthacms/copilot-domain';
import { copilotSkills } from '../schema/skills';

/** A CMS skill as the manage page reads it — the row, plus its provenance. */
export interface SkillRecord extends Skill {
    /** Row id. What the write routes address. */
    id: string;
    /** Whether it is on offer. */
    enabled: boolean;
    /** Who wrote it, when the account still exists. */
    createdBy: string | null;
    /** Row creation timestamp. */
    createdAt: Date;
    /** Last edit. */
    updatedAt: Date;
}

/** The fields a create accepts. */
export interface CreateSkillInput {
    workspaceId: string;
    name: string;
    title: string;
    description: string;
    instructions: string;
    mode: SkillMode;
    enabled: boolean;
    createdBy: string;
}

/** The fields an update accepts — all optional, none of them the workspace. */
export interface UpdateSkillInput {
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
    mode?: SkillMode;
    enabled?: boolean;
}

/**
 * Reads and writes CMS-authored skills.
 *
 * **Every method takes `workspaceId` and filters on it.** `WorkspaceGuard`
 * proves the caller belongs to the workspace they named in the header; nothing
 * upstream proves a *skill id* belongs to that workspace, so a valid session in
 * workspace A could otherwise edit workspace B's instructions by id. Same rule,
 * and same reason, as `ConversationRepository`.
 */
@Injectable()
export class SkillRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /**
     * The executor to run against: the ambient transaction when a caller opened
     * one, the base connection otherwise — so a skill write and the
     * `copilot.skill.*` event describing it commit together. Outside a unit of
     * work this is exactly the old behaviour.
     */
    private get db(): Database {
        return this.uow.current();
    }

    /**
     * The workspace's skills, oldest first.
     *
     * `enabled` selects one of two **disjoint** sets when passed, rather than
     * widening the result: the run catalogue wants only the live ones and the
     * manage page wants everything, and a caller that meant "only live" would
     * otherwise silently offer a skill someone deliberately switched off.
     */
    async list(workspaceId: string, enabled?: boolean): Promise<SkillRecord[]> {
        const rows = await this.db
            .select()
            .from(copilotSkills)
            .where(
                enabled === undefined
                    ? eq(copilotSkills.workspaceId, workspaceId)
                    : and(
                          eq(copilotSkills.workspaceId, workspaceId),
                          eq(copilotSkills.enabled, enabled)
                      )
            )
            .orderBy(asc(copilotSkills.createdAt));
        return rows.map(toRecord);
    }

    /**
     * One skill, or `null` when the id is not this workspace's. Null rather
     * than a throw for "not yours" as well as "no such id" — the two are
     * indistinguishable to a caller, so an id cannot be probed for existence.
     */
    async find(id: string, workspaceId: string): Promise<SkillRecord | null> {
        const [row] = await this.db
            .select()
            .from(copilotSkills)
            .where(
                and(
                    eq(copilotSkills.id, id),
                    eq(copilotSkills.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? toRecord(row) : null;
    }

    /** Whether the workspace already has a skill under this name. */
    async findByName(
        name: string,
        workspaceId: string
    ): Promise<SkillRecord | null> {
        const [row] = await this.db
            .select()
            .from(copilotSkills)
            .where(
                and(
                    eq(copilotSkills.name, name),
                    eq(copilotSkills.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? toRecord(row) : null;
    }

    /** Writes a new skill. */
    async create(input: CreateSkillInput): Promise<SkillRecord> {
        const [row] = await this.db
            .insert(copilotSkills)
            .values(input)
            .returning();
        return toRecord(row);
    }

    /**
     * Applies a patch, returning the updated row — or `null` when the id is not
     * this workspace's.
     *
     * The ownership predicate is part of the `UPDATE` rather than a read
     * beforehand, so there is no check-then-write window.
     */
    async update(
        id: string,
        workspaceId: string,
        patch: UpdateSkillInput
    ): Promise<SkillRecord | null> {
        const [row] = await this.db
            .update(copilotSkills)
            .set({ ...patch, updatedAt: new Date() })
            .where(
                and(
                    eq(copilotSkills.id, id),
                    eq(copilotSkills.workspaceId, workspaceId)
                )
            )
            .returning();
        return row ? toRecord(row) : null;
    }

    /** Deletes a skill. `false` when the id is not this workspace's. */
    async remove(id: string, workspaceId: string): Promise<boolean> {
        const rows = await this.db
            .delete(copilotSkills)
            .where(
                and(
                    eq(copilotSkills.id, id),
                    eq(copilotSkills.workspaceId, workspaceId)
                )
            )
            .returning({ id: copilotSkills.id });
        return rows.length > 0;
    }
}

/** The row, with `source` stamped — a database row is always a CMS skill. */
function toRecord(row: typeof copilotSkills.$inferSelect): SkillRecord {
    return {
        id: row.id,
        name: row.name,
        title: row.title,
        description: row.description,
        instructions: row.instructions,
        mode: row.mode,
        enabled: row.enabled,
        source: 'cms',
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
