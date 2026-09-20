import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import {
    WorkspaceStatus,
    type WorkspaceStatusKey
} from '../../domain/value-objects/workspace-status';
import { WorkspaceNotFoundError } from '../../domain/errors';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';

/**
 * Flips a workspace's lifecycle status (archive / unarchive). Idempotent —
 * setting the status it already has records nothing. Drains
 * `workspace.archived` / `workspace.unarchived` (carrying the actor) on a real
 * change, where the activity subscriber turns it into the audit row. 404s an
 * unknown workspace.
 */
@Injectable()
export class SetWorkspaceStatusUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /** Runs the status change. Throws {@link WorkspaceNotFoundError} (→ 404). */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        status: WorkspaceStatusKey
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);
        const target = WorkspaceStatus.create(status);

        await this.uow.run(async () => {
            const workspace = await this.workspaces.findById(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            if (!workspace.setStatus(target)) {
                return;
            }
            await this.workspaces.save(workspace);
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );
        });
    }
}
