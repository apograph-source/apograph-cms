import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type { WorkspaceDirectory } from '@orthacms/identity-server';
import { workspaces } from '../schema/workspaces';

/**
 * Drizzle-backed {@link WorkspaceDirectory} — the adapter this plugin binds to
 * identity's `WORKSPACE_DIRECTORY` port so identity can validate an API token's
 * workspace bucket without depending on this package (which depends back on it).
 *
 * One `IN` query for the whole set, never one per id: a token's bucket may hold
 * up to a hundred workspaces.
 *
 * Existence, not status: an **archived** workspace still exists and a token may
 * legitimately be scoped to one. What the check rejects is an id that names no
 * workspace at all.
 */
@Injectable()
export class WorkspaceExistenceQuery implements WorkspaceDirectory {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** {@inheritDoc WorkspaceDirectory.existing} */
    async existing(workspaceIds: readonly string[]): Promise<string[]> {
        if (workspaceIds.length === 0) {
            return [];
        }
        const rows = await this.db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(inArray(workspaces.id, [...workspaceIds]));
        return rows.map((row) => row.id);
    }
}
