import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards
} from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';
import { ContentEntryCounterReader } from '../../application/content/content-entry-counter.reader';

/**
 * `GET /api/workspaces/:id/entry-count` — total content entries the workspace
 * holds across every content type. Backs the settings UI's delete pre-check, so
 * it's gated by the same `workspaces:delete` as the delete it guards. A read, so
 * no `OriginGuard`. Returns `{ count }` (0 when no content plugin is bound).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_DELETE)
@Controller('workspaces')
export class GetWorkspaceEntryCountController {
    constructor(private readonly counter: ContentEntryCounterReader) {}

    @Get(':id/entry-count')
    async count(
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<{ count: number }> {
        return { count: await this.counter.countWorkspaceEntries(id) };
    }
}
