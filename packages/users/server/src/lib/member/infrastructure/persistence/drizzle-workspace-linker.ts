import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { memberships, workspaces } from '@orthacms/workspaces-server';
import type { WorkspaceLinker } from '../../application/ports/workspace-linker.port';

/**
 * Drizzle-backed {@link WorkspaceLinker} over the workspaces context's
 * `workspaces`/`memberships` tables. Filters the requested ids to ones that
 * resolve to real workspaces so a stale id can't fail the invite, then inserts
 * the memberships with `onConflictDoNothing` (duplicates are no-ops). Runs
 * through {@link UnitOfWork.current} so the links commit with the invite.
 */
@Injectable()
export class DrizzleWorkspaceLinker implements WorkspaceLinker {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc WorkspaceLinker.link} */
    async link(userId: string, workspaceIds: string[]): Promise<void> {
        const unique = [...new Set(workspaceIds)];
        if (unique.length === 0) {
            return;
        }
        const executor = this.uow.current();
        const existing = await executor
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(inArray(workspaces.id, unique));
        if (existing.length === 0) {
            return;
        }
        await executor
            .insert(memberships)
            .values(existing.map(({ id }) => ({ userId, workspaceId: id })))
            .onConflictDoNothing();
    }
}
