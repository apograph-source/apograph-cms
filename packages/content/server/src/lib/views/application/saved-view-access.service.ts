import { Injectable } from '@nestjs/common';
import {
    AccessPolicy,
    PERMISSIONS,
    Permission,
    PermissionsService,
    type PublicUser
} from '@orthacms/identity-server';
import { VIEW_VISIBILITY, type ViewVisibility } from '../domain/saved-view';
import type { SavedViewRecord } from '../domain/saved-view.repository';
import { SavedViewForbiddenError } from '../domain/errors';

/**
 * The two authorization rules saved views add on top of the route guards.
 *
 * The guards already establish that the caller is authenticated, a member of
 * the open workspace, and may read content. What is left is per-row and
 * per-visibility, so it cannot live in a decorator:
 *
 *  - **Only the owner writes.** Editing or deleting someone else's view is a
 *    403 even for an administrator — a shared view is its author's, and the
 *    remedy for disagreeing with one is "Save as new", not a silent rewrite.
 *  - **Sharing is a permission.** Making a view workspace-visible needs
 *    `views:share`; a member without it still saves as many private views as
 *    they like.
 */
@Injectable()
export class SavedViewAccessService {
    constructor(
        private readonly permissions: PermissionsService,
        private readonly accessPolicy: AccessPolicy
    ) {}

    /** Throws unless `user` owns `view`. */
    assertOwned(view: SavedViewRecord, user: PublicUser): void {
        if (view.ownerId !== user.id) {
            throw new SavedViewForbiddenError(
                'Only the person who saved a view can change it. Use “Save as new” instead.'
            );
        }
    }

    /**
     * Throws unless `user` may store a view at `visibility`. Private views need
     * nothing beyond membership; workspace-visible ones need `views:share`.
     */
    async assertCanUseVisibility(
        visibility: ViewVisibility,
        user: PublicUser
    ): Promise<void> {
        if (visibility !== VIEW_VISIBILITY.Workspace) return;
        const granted = await this.permissions.forRole(user.roleId);
        const allowed = this.accessPolicy.can(
            { userId: user.id, grantedPermissions: new Set(granted) },
            Permission.create(PERMISSIONS.VIEWS_SHARE)
        );
        if (!allowed) {
            throw new SavedViewForbiddenError(
                'Sharing a view with the workspace requires the “views:share” permission.'
            );
        }
    }
}
