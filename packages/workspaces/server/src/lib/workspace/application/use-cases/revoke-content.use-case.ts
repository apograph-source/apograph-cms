import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import {
    EntryCountUnavailableError,
    WorkspaceNotFoundError
} from '../../domain/errors';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import { ContentEntryCounterReader } from '../content/content-entry-counter.reader';

/**
 * Revokes a workspace's access to one content type — **only when the type holds
 * no entries in that workspace** (`ContentTypeNotEmptyError` → 409 otherwise),
 * so a revoke never orphans reachable records. Revoking a grant the workspace
 * never held is a no-op. Drains `workspace.content_revoked` (carrying the
 * actor) on a real change, where the activity subscriber turns it into the
 * audit row. 404s an unknown workspace.
 *
 * Loads the aggregate under the workspace's exclusive content lock
 * ({@link WorkspaceRepository.findByIdForContentMutation}), so a concurrent
 * entry create can't slip a row in between the count and the grant removal.
 */
@Injectable()
export class RevokeContentUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly counter: ContentEntryCounterReader,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /**
     * Runs the revoke. Throws {@link WorkspaceNotFoundError} (→ 404) and
     * `ContentTypeNotEmptyError` (→ 409) when the type still holds entries.
     */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        slug: string
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);

        await this.uow.run(async () => {
            const workspace =
                await this.workspaces.findByIdForContentMutation(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            // Same fail-closed rule as the delete: an unbound counter reports
            // 0 for a type whose rows may very much exist.
            if (!this.counter.isBound) {
                throw new EntryCountUnavailableError(workspaceId);
            }
            const entryCount = await this.counter.countEntries(
                workspaceId,
                slug
            );
            if (!workspace.revokeContent(slug, entryCount)) {
                return;
            }
            await this.workspaces.save(workspace);
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );
        });
    }
}
