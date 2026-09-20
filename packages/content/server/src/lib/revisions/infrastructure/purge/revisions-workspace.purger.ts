import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import { contentEntryRevisions } from '../persistence/revision-table';

/**
 * Removes a deleted workspace's entry revisions.
 *
 * Content is otherwise the plugin that does **not** purge: a workspace holding
 * entries is refused (409), because entries are authored records someone must
 * delete deliberately. Revisions fall outside that protection in both
 * directions. They carry a plain `workspace_id` with no foreign key, and
 * `countWorkspaceEntries` sums the live `content_<name>` tables only — so a
 * workspace whose entries have all been deleted counts as empty, deletes
 * cleanly, and leaves its whole revision history behind pointing at nothing.
 *
 * That history is not an authored record in its own right: it is the version
 * timeline of rows that are already gone, unreachable once the workspace it was
 * scoped to no longer opens. Purging it is the same call the folder tree and the
 * token bucket get — scoping rows with no independent meaning left.
 */
@Injectable()
export class RevisionsWorkspacePurger implements WorkspacePurger, OnModuleInit {
    readonly purgeName = 'content:entry-revisions';

    constructor(
        private readonly uow: UnitOfWork,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const removed = await this.uow
            .current()
            .delete(contentEntryRevisions)
            .where(eq(contentEntryRevisions.workspaceId, workspaceId))
            .returning({ id: contentEntryRevisions.id });

        return { rows: removed.length };
    }
}
