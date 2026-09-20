import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Query,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ActivityService } from '../services/activity.service';
import { EntryActivityQueryDto } from '../dto/entry-activity-query.dto';
import type { ActivityListView } from '../types/activity-view';

/**
 * `GET /api/activity/entries/:entryId` — one entry's own audit trail.
 *
 * **Why this exists next to `GET /activity` rather than as a filter on it.**
 * The full log is gated on `activity:read`, which is admin-only in the v1 role
 * matrix and correctly so: it carries invites, role changes and sign-in
 * failures across the whole deployment. The consequence was that an editor
 * could not see the history of their **own** content — the entry editor's
 * History tab shows version snapshots, which record what the words were and
 * say nothing about who published it, who took it down, or who changed who may
 * read it. Those are different facts and they live here.
 *
 * So this route asks a different question with a different key. `content:read`
 * is the permission that already decides whether you may look at an entry at
 * all, and everything returned is about an entry you may look at.
 *
 * **It is scoped by workspace, and fails closed.** `WorkspaceGuard` proves
 * membership, and the query requires the row's `workspace_id` to match — so an
 * entry id from another workspace reads as an empty history rather than as
 * somebody else's. Rows written before `workspace_id` existed carry `null` and
 * are therefore excluded: losing old history on this narrow route is the right
 * side to err on, and the full log still has them.
 */
@ApiTags('Activity')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('activity/entries')
export class EntryActivityController {
    constructor(private readonly activity: ActivityService) {}

    @Get(':entryId')
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @ApiOperation({
        summary: 'One entry’s audit trail',
        description:
            'Every recorded action on this entry — created, edited, published, deleted, restored, and who may read it — newest first. Scoped to the open workspace; an id from another one reads as an empty history. Gated on `content:read` rather than `activity:read`, so an editor can see the history of content they can already open.'
    })
    list(
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @CurrentWorkspace() workspaceId: string,
        @Query() query: EntryActivityQueryDto
    ): Promise<ActivityListView> {
        return this.activity.list({
            subjectType: 'content_entry',
            subjectId: entryId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize
        });
    }
}
