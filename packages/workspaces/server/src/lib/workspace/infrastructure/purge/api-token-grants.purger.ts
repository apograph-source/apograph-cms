import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { apiTokenWorkspaces } from '@orthacms/identity-server';
import type {
    WorkspacePurger,
    WorkspacePurgeOutcome
} from '../../application/ports/workspace-purger.port';
import { WorkspacePurgeRegistry } from '../../application/workspace-purge.registry';

/**
 * Removes a deleted workspace's rows from identity's `api_token_workspaces`.
 *
 * **Why this lives in the workspaces package rather than in identity.** Every
 * other purger registers itself from its own plugin, which is the inversion
 * that keeps the graph acyclic. Identity is the one case where that direction
 * is reversed: *this* package depends on `@orthacms/identity-server` (for
 * `PublicUser`, the RBAC guards, the users table), so identity cannot depend
 * back on it to reach `WorkspacePurgeRegistry`. The adapter therefore sits on
 * this side, reaching into identity's table the same way
 * `DrizzleMemberProvisioner` already reaches into `users`.
 *
 * **What the rows are.** A token's workspace bucket — which workspaces one API
 * token may act in. `token_id` cascades from `api_tokens`, but `workspace_id`
 * carries no FK by design (documented on the table), so deleting a workspace
 * used to leave the grant behind: a live credential still scoped to an id that
 * resolves to nothing. Identity already refuses to *mint* a token naming a
 * workspace that does not exist (`WORKSPACE_DIRECTORY`); this closes the same
 * hole at the other end of the lifecycle.
 *
 * Deleting the grant does not revoke the token — a token scoped to three
 * workspaces keeps working in the other two. A token left with **no** buckets
 * is a token that can reach nothing, which is the correct outcome for a
 * credential whose only workspace was deleted; revoking it outright would be a
 * policy decision this purger has no standing to make.
 */
@Injectable()
export class ApiTokenGrantsPurger implements WorkspacePurger, OnModuleInit {
    readonly purgeName = 'identity:api-token-workspaces';

    constructor(
        private readonly uow: UnitOfWork,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    /** Join the purge registry once the DI graph is built. */
    onModuleInit(): void {
        this.registry?.register(this);
    }

    /** {@inheritDoc WorkspacePurger.purge} */
    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const removed = await this.uow
            .current()
            .delete(apiTokenWorkspaces)
            .where(eq(apiTokenWorkspaces.workspaceId, workspaceId))
            .returning({ tokenId: apiTokenWorkspaces.tokenId });

        return { rows: removed.length };
    }
}
