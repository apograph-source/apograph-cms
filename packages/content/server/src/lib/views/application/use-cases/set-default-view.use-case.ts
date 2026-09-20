import { Inject, Injectable } from '@nestjs/common';
import type { PublicUser } from '@orthacms/identity-server';
import { VIEW_VISIBILITY } from '../../domain/saved-view';
import {
    SAVED_VIEW_REPOSITORY,
    type SavedViewRepository
} from '../../domain/saved-view.repository';
import { SavedViewNotFoundError } from '../../domain/errors';

/**
 * Points a user's default for one list at a view, or clears it.
 *
 * Deliberately **not** owner-gated: a default is the reader's own landing
 * choice, so anyone who can see a shared view may land on it. What is gated is
 * visibility — the view has to be one this caller can actually read, which is
 * what the ownership-or-shared check below establishes.
 */
@Injectable()
export class SetDefaultViewUseCase {
    constructor(
        @Inject(SAVED_VIEW_REPOSITORY)
        private readonly repository: SavedViewRepository
    ) {}

    async execute(
        id: string,
        workspaceId: string,
        user: PublicUser
    ): Promise<void> {
        const existing = await this.repository.findById(id);
        const readable =
            existing &&
            existing.workspaceId === workspaceId &&
            (existing.ownerId === user.id ||
                existing.visibility === VIEW_VISIBILITY.Workspace);
        if (!existing || !readable) throw new SavedViewNotFoundError(id);
        await this.repository.setDefault(user.id, existing.scope, id);
    }

    /**
     * Clears the caller's default for the scope `id` belongs to. Addressed by
     * view id rather than by scope so the route sits beside its `PUT`
     * counterpart instead of colliding with `DELETE /views/:id`. Idempotent:
     * clearing when the default points elsewhere, or nowhere, still succeeds.
     */
    async executeClear(
        id: string,
        workspaceId: string,
        user: PublicUser
    ): Promise<void> {
        const existing = await this.repository.findById(id);
        if (!existing || existing.workspaceId !== workspaceId) {
            throw new SavedViewNotFoundError(id);
        }
        await this.repository.clearDefault(user.id, existing.scope);
    }
}
