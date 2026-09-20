import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import { entryAccess } from '../../schema/entry-access';

/**
 * Removes a deleted workspace's per-entry audience rows.
 *
 * `entry_access.workspace_id` is a plain uuid with no foreign key — this plugin
 * holds no cross-plugin FK — and the only other deletes are per-entry and
 * per-segment, so nothing reached these rows when the workspace itself went.
 * A workspace can only be deleted once it holds no entries, which makes every
 * surviving row an access decision about an entry that no longer exists: pure
 * scoping with nothing left to scope.
 *
 * Note what is deliberately **not** purged here: `segments.workspace_ids`. A
 * dangling id in that array narrows the audience rather than widening it, which
 * the column's own docblock records as the accepted outcome — removing it would
 * silently broaden who may read an entry, which is the failure this plugin
 * exists to prevent.
 */
@Injectable()
export class EntryAccessWorkspacePurger
    implements WorkspacePurger, OnModuleInit
{
    readonly purgeName = 'segments:entry-access';

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
            .delete(entryAccess)
            .where(eq(entryAccess.workspaceId, workspaceId))
            .returning({ entryId: entryAccess.entryId });

        return { rows: removed.length };
    }
}
