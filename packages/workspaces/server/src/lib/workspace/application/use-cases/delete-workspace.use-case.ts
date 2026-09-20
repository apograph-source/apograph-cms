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
import { WorkspacePurgeRegistry } from '../workspace-purge.registry';

/**
 * Permanently deletes a workspace. Three different mechanisms clear its rows,
 * and which one applies is a property of what the rows *are*:
 *
 * - **Cascade** — `memberships`, `workspace_content` and copilot's tables carry
 *   an FK to `workspaces`, so the database removes them.
 * - **Refuse** — content **entries** are workspace-scoped by a plain uuid with
 *   no FK, and they are authored records, so the delete is refused with
 *   `WorkspaceNotEmptyError` (→ 409) while any remain. A user deletes their
 *   content deliberately; we never do it for them.
 * - **Purge** — the rest of the cross-plugin rows (media assets and folders, a
 *   token's workspace bucket) are pure scoping with no independent meaning, so
 *   {@link WorkspacePurgeRegistry} deletes them in this transaction. See
 *   `WorkspacePurger` for why they can't simply carry a foreign key.
 *
 * Drains `workspace.deleted` (carrying the actor), where the activity
 * subscriber turns it into the audit row. 404s an unknown workspace.
 *
 * Loads the aggregate under the workspace's exclusive content lock
 * ({@link WorkspaceRepository.findByIdForContentMutation}), so a concurrent
 * entry create can't slip a row in between the count and the delete.
 */
@Injectable()
export class DeleteWorkspaceUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly counter: ContentEntryCounterReader,
        private readonly purgers: WorkspacePurgeRegistry,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /**
     * Runs the delete. Throws {@link WorkspaceNotFoundError} (→ 404),
     * `WorkspaceNotEmptyError` (→ 409) when content entries remain, and
     * {@link EntryCountUnavailableError} (→ 503) when the count can't be taken.
     */
    async execute(actor: PublicUser, workspaceId: string): Promise<void> {
        const id = WorkspaceId.create(workspaceId);

        const reclaim = await this.uow.run(async () => {
            const workspace =
                await this.workspaces.findByIdForContentMutation(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            // Fail closed on an unknown count: the unbound fallback reads 0,
            // which would wave through exactly the delete the invariant exists
            // to stop (a database whose content tables outlived the plugin).
            if (!this.counter.isBound) {
                throw new EntryCountUnavailableError(workspaceId);
            }
            const entryCount =
                await this.counter.countWorkspaceEntries(workspaceId);
            workspace.assertDeletable(entryCount);

            // Purge before the workspace row goes, so a purger can still read
            // it if it needs to, and so a throwing purger rolls the whole
            // delete back rather than leaving a half-deleted workspace.
            const purged = await this.purgers.purgeAll(workspaceId);

            await this.workspaces.delete(workspace);
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );
            return purged.reclaim;
        });

        // Non-transactional cleanup (stored blobs) runs only once the rows are
        // committed — a rolled-back delete must never destroy bytes belonging
        // to a workspace that still exists.
        await reclaim();
    }
}
