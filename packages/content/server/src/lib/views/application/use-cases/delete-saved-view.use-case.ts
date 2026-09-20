import { Inject, Injectable } from '@nestjs/common';
import type { PublicUser } from '@ortha/identity-server';
import { attachActor, OutboxWriter, UnitOfWork } from '@ortha/database';
import {
    SAVED_VIEW_EVENT_KINDS,
    savedViewEvent
} from '../../domain/events/saved-view-events';
import {
    SAVED_VIEW_REPOSITORY,
    type SavedViewRepository
} from '../../domain/saved-view.repository';
import { SavedViewNotFoundError } from '../../domain/errors';
import { SavedViewAccessService } from '../saved-view-access.service';

/**
 * Deletes a view the caller owns. Anyone else's default pointing at it is
 * cascaded away by the FK, so they fall back to the unfiltered list rather than
 * to a dangling id.
 */
@Injectable()
export class DeleteSavedViewUseCase {
    constructor(
        @Inject(SAVED_VIEW_REPOSITORY)
        private readonly repository: SavedViewRepository,
        private readonly access: SavedViewAccessService,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    async execute(
        id: string,
        workspaceId: string,
        user: PublicUser
    ): Promise<void> {
        const existing = await this.repository.findById(id);
        if (!existing || existing.workspaceId !== workspaceId) {
            throw new SavedViewNotFoundError(id);
        }
        this.access.assertOwned(existing, user);
        await this.uow.run(async () => {
            await this.repository.delete(id);
            // The view's own details, because this is the last place they
            // exist — and a shared view leaving everyone's switcher is a
            // change to what a team can see, not just to one person's list.
            await this.outbox.append(
                attachActor(
                    [
                        savedViewEvent(SAVED_VIEW_EVENT_KINDS.DELETED, id, {
                            workspaceId,
                            scope: existing.scope,
                            name: existing.name,
                            visibility: existing.visibility
                        })
                    ],
                    { id: user.id, email: user.email ?? null }
                )
            );
        });
    }
}
