import { Injectable } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { users } from '@orthacms/identity-server';
import { workspaces } from '../schema/workspaces';
import { memberships } from '../schema/memberships';
import { workspaceContent } from '../schema/workspace-content';
import type {
    WorkspaceMemberView,
    WorkspaceView
} from '../../application/queries/workspace.view';

/** A `workspaces` row as selected for view assembly. */
type WorkspaceRow = typeof workspaces.$inferSelect;

/**
 * Read model that assembles {@link WorkspaceView}s — the workspace endpoints'
 * response shape — from the workspace, membership, and content-grant tables.
 * A thin CQRS query service: it bypasses the aggregate (reads don't enforce
 * invariants) and reads the base connection, so it sees committed state after a
 * use case's unit of work closes.
 */
@Injectable()
export class WorkspaceViewQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /**
     * The workspaces `userId` is a member of, newest first, each with its
     * members and grants — the only list read this query offers, by design.
     * Membership is the tenancy boundary, so there is deliberately **no**
     * unscoped `listAll()` to reach for: a user never learns that a workspace
     * they don't belong to exists.
     */
    async listForMember(userId: string): Promise<WorkspaceView[]> {
        const rows = await this.db
            .select({ workspace: workspaces })
            .from(workspaces)
            .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
            .where(eq(memberships.userId, userId))
            .orderBy(desc(workspaces.createdAt));
        if (rows.length === 0) return [];
        // The `(workspace_id, user_id)` unique constraint makes the join
        // at-most-one-row-per-workspace, so no de-duplication is needed.
        return this.toViews(rows.map((row) => row.workspace));
    }

    /**
     * The view for one workspace, or `null` when it doesn't exist.
     *
     * **Unscoped by itself, and the scope is not established here.** It returns
     * the full member roster (ids, names, emails) and every content grant for
     * whatever id it is handed, so a caller that passes an attacker-supplied id
     * without first proving membership discloses another tenant's workspace
     * outright. There is no second line of defence.
     *
     * Every current caller is safe, but not for one uniform reason, so check
     * which case a new one is:
     * - the five mutation controllers (`update`, `set-status`, `add-member`,
     *   `add-content`, `remove-content`) sit behind `WorkspaceMemberGuard`,
     *   which has already established membership for that id;
     * - `create-workspace.controller` does **not** carry that guard — it is
     *   safe only because it passes the id its own use case just minted, which
     *   no caller supplied.
     *
     * Prefer {@link listForMember}, which bakes the membership join into the
     * query so it cannot be forgotten.
     */
    async byId(workspaceId: string): Promise<WorkspaceView | null> {
        const rows = await this.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId));
        if (rows.length === 0) return null;
        const [view] = await this.toViews(rows);
        return view;
    }

    /** Maps workspace rows to views, attaching each one's members and grants. */
    private async toViews(rows: WorkspaceRow[]): Promise<WorkspaceView[]> {
        const ids = rows.map((row) => row.id);
        const [membersByWorkspace, grantsByWorkspace] = await Promise.all([
            this.membersByWorkspace(ids),
            this.grantsByWorkspace(ids)
        ]);
        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description ?? '',
            color: row.color,
            status: row.status,
            members: membersByWorkspace.get(row.id) ?? [],
            content: grantsByWorkspace.get(row.id) ?? []
        }));
    }

    /**
     * Groups members by workspace id in a deterministic order (earliest
     * membership first, `id` breaking `created_at` ties). Ordering is
     * presentation-only — a member carries no role.
     */
    private async membersByWorkspace(
        workspaceIds: string[]
    ): Promise<Map<string, WorkspaceMemberView[]>> {
        const byWorkspace = new Map<string, WorkspaceMemberView[]>();
        if (workspaceIds.length === 0) return byWorkspace;
        const rows = await this.db
            .select({
                workspaceId: memberships.workspaceId,
                id: users.id,
                name: users.name,
                email: users.email
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(inArray(memberships.workspaceId, workspaceIds))
            .orderBy(memberships.createdAt, memberships.id);
        for (const row of rows) {
            const list = byWorkspace.get(row.workspaceId) ?? [];
            list.push({ id: row.id, name: row.name, email: row.email });
            byWorkspace.set(row.workspaceId, list);
        }
        return byWorkspace;
    }

    /** Groups each workspace's granted content slugs by workspace id. */
    private async grantsByWorkspace(
        workspaceIds: string[]
    ): Promise<Map<string, string[]>> {
        const byWorkspace = new Map<string, string[]>();
        if (workspaceIds.length === 0) return byWorkspace;
        const rows = await this.db
            .select({
                workspaceId: workspaceContent.workspaceId,
                slug: workspaceContent.slug
            })
            .from(workspaceContent)
            .where(inArray(workspaceContent.workspaceId, workspaceIds));
        for (const row of rows) {
            const list = byWorkspace.get(row.workspaceId) ?? [];
            list.push(row.slug);
            byWorkspace.set(row.workspaceId, list);
        }
        return byWorkspace;
    }
}
