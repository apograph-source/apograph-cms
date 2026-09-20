import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { roles, users } from '@orthacms/identity-server';
import { memberships } from '@orthacms/workspaces-server';

/** One member of a workspace, as the copilot's `workspace.members` reports them. */
export interface WorkspaceMemberView {
    /** The member's user id. */
    id: string;
    /** Contact email — the invite recipient while `pending`. */
    email: string;
    /** Display name, or `null` until they set one on invite accept. */
    name: string | null;
    /** Their single global role's machine key (`admin` / `contributor` / …). */
    roleKey: string;
    /** The role's human-readable label. */
    roleName: string;
    /** Account lifecycle state. */
    status: 'pending' | 'active' | 'disabled';
}

/** One page of a workspace's members. */
export interface WorkspaceMemberListView {
    items: WorkspaceMemberView[];
    total: number;
    page: number;
    pageSize: number;
}

/**
 * The members of **one workspace** — `memberships ⋈ users ⋈ roles`, paginated.
 *
 * A purpose-built read rather than a parameter on {@link MemberViewQuery}: that
 * one is the deployment-wide directory the users grid renders, and it has no
 * workspace predicate at all. Adding one would mean threading a workspace
 * through the admin's whole member list contract for a caller that wants a
 * strictly narrower answer and none of its extras (`isLastAdmin`, the
 * per-member workspace list, the `?filter=` tree).
 *
 * The scoping is the point. A copilot run is workspace-scoped, so "who is on
 * this team?" must not answer with the deployment's whole user directory —
 * `users:read` alone would permit exactly that.
 */
@Injectable()
export class WorkspaceMembersQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** One page of `workspaceId`'s members, ordered by name with an id tiebreaker. */
    async list(
        workspaceId: string,
        page: number,
        pageSize: number
    ): Promise<WorkspaceMemberListView> {
        const where = eq(memberships.workspaceId, workspaceId);

        // Count and page rows share the WHERE but are otherwise independent;
        // run them concurrently so the read pays the max of the two, not the
        // sum — the same shape `MemberViewQuery.list` uses.
        const [[total], rows] = await Promise.all([
            this.db.select({ value: count() }).from(memberships).where(where),
            this.db
                .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    status: users.status,
                    roleKey: roles.key,
                    roleName: roles.name
                })
                .from(memberships)
                .innerJoin(users, eq(memberships.userId, users.id))
                .innerJoin(roles, eq(users.roleId, roles.id))
                .where(and(where))
                .orderBy(users.name, users.id)
                .limit(pageSize)
                .offset((page - 1) * pageSize)
        ]);

        return {
            items: rows,
            total: total?.value ?? 0,
            page,
            pageSize
        };
    }
}
