import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    CurrentUser,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';

/**
 * `GET /api/workspaces` — lists the workspaces the caller is a **member** of,
 * with their members and content grants; requires `workspaces:read`.
 *
 * Membership is the tenancy boundary, so the response is scoped to it rather
 * than returning every workspace: the admin's sidebar, workspace switcher,
 * command palette, and home widgets all render from this list, and a workspace
 * the user doesn't belong to must not appear in any of them. Scoping here also
 * means the list can't be used to enumerate workspace ids.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_READ)
@Controller('workspaces')
export class ListWorkspacesController {
    constructor(private readonly views: WorkspaceViewQuery) {}

    @Get()
    list(@CurrentUser() actor: PublicUser): Promise<WorkspaceView[]> {
        return this.views.listForMember(actor.id);
    }
}
