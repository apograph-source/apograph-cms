import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    AccessPolicy,
    PERMISSIONS,
    Permission,
    PermissionsService,
    users
} from '@orthacms/identity-server';
import { memberships } from '@orthacms/workspaces-server';

/** Somebody who may be asked to review. */
export interface ReviewerCandidate {
    userId: string;
    /** For a caller with no roster of its own to put a name to the id — a model. */
    email: string;
}

/**
 * Who in a workspace can be asked to review: its members who hold
 * `content:approve`, minus the person asking.
 *
 * **One definition for both ends of the request.** The picker is offered
 * exactly this list, and the request route refuses anybody outside it — so a
 * reviewer somebody could pick is a reviewer the server accepts, and a viewer
 * can never be left standing in a request as a pending reviewer who has no way
 * to approve.
 *
 * The caller is excluded because asking yourself is not a request. The head's
 * author is **not** excluded: who wrote the current version moves with every
 * save, while a request outlives saves — and whether a particular vote counts
 * is the kernel's four-eyes rule, not this list's.
 *
 * It reads `memberships` and `users` through the schema objects their plugins
 * export, and resolves permissions through identity's own service rather than
 * joining role tables here, for the reason `PermissionsService.forUser` gives.
 * That is one permission read per member; a workspace's roster is small, and
 * this runs when somebody opens a picker, not on a page of records.
 */
@Injectable()
export class ReviewerCandidatesQuery {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly permissions: PermissionsService,
        private readonly accessPolicy: AccessPolicy
    ) {}

    /** The workspace's possible reviewers for a request `callerId` makes. */
    async list(
        workspaceId: string,
        callerId: string
    ): Promise<ReviewerCandidate[]> {
        const rows = await this.uow
            .current()
            .select({ userId: memberships.userId, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.workspaceId, workspaceId))
            .orderBy(asc(users.email));

        const eligible = await Promise.all(
            rows
                .filter((row) => row.userId !== callerId)
                .map(async (row) => ({
                    row,
                    canApprove: await this.canApprove(row.userId)
                }))
        );
        return eligible
            .filter((candidate) => candidate.canApprove)
            .map(({ row }) => ({ userId: row.userId, email: row.email }));
    }

    private async canApprove(userId: string): Promise<boolean> {
        const granted = await this.permissions.forUser(userId);
        return this.accessPolicy.can(
            { userId, grantedPermissions: new Set(granted) },
            Permission.create(PERMISSIONS.CONTENT_APPROVE)
        );
    }
}
