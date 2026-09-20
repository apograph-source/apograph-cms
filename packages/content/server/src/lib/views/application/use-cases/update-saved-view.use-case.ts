import { Inject, Injectable } from '@nestjs/common';
import type { PublicUser } from '@orthacms/identity-server';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    SAVED_VIEW_EVENT_KINDS,
    savedViewEvent
} from '../../domain/events/saved-view-events';
import { isUniqueViolation } from '@orthacms/utils-server';
import type {
    SavedView,
    SavedViewPayload,
    ViewVisibility
} from '../../domain/saved-view';
import {
    SAVED_VIEW_REPOSITORY,
    type SavedViewRepository
} from '../../domain/saved-view.repository';
import {
    SavedViewNameTakenError,
    SavedViewNotFoundError
} from '../../domain/errors';
import { SavedViewAccessService } from '../saved-view-access.service';
import { toSavedView } from '../queries/saved-views.query';

/** The fields `PATCH /api/views/:id` may change. */
export interface UpdateSavedViewInput {
    /** New display name. */
    name?: string;
    /** New visibility. */
    visibility?: ViewVisibility;
    /** New slice. */
    payload?: SavedViewPayload;
}

/** Renames, re-shares, or re-captures an existing view. */
@Injectable()
export class UpdateSavedViewUseCase {
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
        input: UpdateSavedViewInput,
        user: PublicUser
    ): Promise<SavedView> {
        const existing = await this.repository.findById(id);
        // The workspace check is part of the not-found decision, not a separate
        // 403: an id from another workspace must read exactly like an unknown
        // one, or the endpoint becomes a probe for views elsewhere.
        if (!existing || existing.workspaceId !== workspaceId) {
            throw new SavedViewNotFoundError(id);
        }
        this.access.assertOwned(existing, user);
        if (input.visibility !== undefined) {
            await this.access.assertCanUseVisibility(input.visibility, user);
        }

        // Every field is optional, so `{}` is a valid body — and it would reach
        // Drizzle as `.set({})`, which throws rather than updating nothing.
        // Answer the row unchanged instead: a patch that asks for no change has
        // already got what it asked for.
        const changes =
            input.name !== undefined ||
            input.visibility !== undefined ||
            input.payload !== undefined;
        if (!changes) {
            const currentDefault = await this.repository.findDefaultId(
                user.id,
                existing.scope
            );
            return toSavedView(existing, user.id, currentDefault);
        }

        let updated;
        try {
            updated = await this.uow.run(async () => {
                const row = await this.repository.update(id, input);
                await this.outbox.append(
                    attachActor(
                        [
                            savedViewEvent(SAVED_VIEW_EVENT_KINDS.UPDATED, id, {
                                workspaceId,
                                scope: existing.scope,
                                name: row.name,
                                // The keys the caller actually sent — a
                                // patch, so "what changed" is the request.
                                fields: Object.keys(input),
                                // Called out on its own: sharing is a
                                // permission of its own, and unsharing
                                // takes a view out of every member's
                                // switcher without telling them.
                                visibility: {
                                    from: existing.visibility,
                                    to: row.visibility
                                }
                            })
                        ],
                        { id: user.id, email: user.email ?? null }
                    )
                );
                return row;
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new SavedViewNameTakenError(input.name ?? existing.name);
            }
            throw error;
        }
        const defaultId = await this.repository.findDefaultId(
            user.id,
            updated.scope
        );
        return toSavedView(updated, user.id, defaultId);
    }
}
