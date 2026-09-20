import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import { WorkspaceColor } from '../../domain/value-objects/workspace-color';
import { WorkspaceNotFoundError } from '../../domain/errors';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import type { WorkspaceProfilePatch } from '../../domain/workspace';
import type { UpdateWorkspaceDto } from '../dto/update-workspace.dto';

/**
 * Applies a partial profile edit (name / description / color) to a workspace.
 * A patch with no fields present is a no-op that still succeeds (the controller
 * returns the current view). Drains `workspace.updated` (carrying the changed
 * field names + the actor) only when something actually changed, where the
 * activity subscriber turns it into the audit row. 404s an unknown workspace.
 */
@Injectable()
export class UpdateWorkspaceUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /** Runs the update. Throws {@link WorkspaceNotFoundError} (→ 404). */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        dto: UpdateWorkspaceDto
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);

        const patch: WorkspaceProfilePatch = {};
        if (dto.name !== undefined) {
            patch.name = dto.name;
        }
        if (dto.description !== undefined) {
            patch.description = dto.description;
        }
        if (dto.color !== undefined) {
            patch.color = WorkspaceColor.create(dto.color);
        }

        await this.uow.run(async () => {
            const workspace = await this.workspaces.findById(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            if (!workspace.updateProfile(patch)) {
                return;
            }
            await this.workspaces.save(workspace);
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );
        });
    }
}
