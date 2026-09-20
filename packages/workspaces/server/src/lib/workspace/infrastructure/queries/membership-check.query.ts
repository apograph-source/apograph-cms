import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { memberships } from '../schema/memberships';

/**
 * The membership existence probe backing {@link WorkspaceGuard} — the
 * authorization boundary for workspace-scoped resources (content entries,
 * locale groups). A non-member must not read or write a workspace's data even
 * with a valid session. A single-row lookup, index-covered by the
 * `(workspace_id, user_id)` unique constraint.
 */
@Injectable()
export class MembershipCheckQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Whether `userId` is a member of `workspaceId`. */
    async isMember(userId: string, workspaceId: string): Promise<boolean> {
        const [row] = await this.db
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
                and(
                    eq(memberships.userId, userId),
                    eq(memberships.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return !!row;
    }
}
