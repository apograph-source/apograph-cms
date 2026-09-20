import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EventActor } from '@orthacms/database';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import {
    SegmentsService,
    type SegmentListView,
    type SegmentView
} from '../application/segments.service';
import {
    CreateSegmentDto,
    ListSegmentsQueryDto,
    LookupSegmentsQueryDto,
    UpdateSegmentDto
} from './segments.dto';

/**
 * The segment directory — a plain CRUD resource over one thing.
 *
 * Not workspace-scoped: a segment is an installation-wide audience, like a
 * content type, and one copy per workspace would mean renaming a customer in
 * each of them.
 *
 * Reading is `segments:read`, held by contributor and viewer — an editor who
 * cannot see that an entry is restricted will publish one believing it is
 * public. Writing is `segments:manage`, admin-only: renaming a segment's tags
 * changes who every entry that names it is visible to.
 */
@ApiTags('Segments')
@Controller('segments')
@UseGuards(PermissionsGuard)
export class SegmentsController {
    constructor(private readonly segments: SegmentsService) {}

    /** One page of the directory, with how many entries name each row. */
    @Get()
    @RequirePermissions(PERMISSIONS.SEGMENTS_READ)
    @ApiOperation({
        summary: 'List segments',
        description:
            'One page of the audiences readers can be divided into. `total: 0` with no filter means nothing is segmented: every published entry is readable by everyone. `ids` carries **every** match rather than this page’s, capped — it is what the entry editor’s "set every audience to…" acts on, so a bulk action means the whole list rather than whichever rows are on screen.'
    })
    list(@Query() query: ListSegmentsQueryDto): Promise<SegmentListView> {
        return this.segments.list({
            query: query.q,
            workspaceId: query.workspace,
            page: query.page,
            pageSize: query.pageSize
        });
    }

    /**
     * Resolve named segments, whatever page they would fall on.
     *
     * Declared **before** `:id` so the literal segment wins the match.
     */
    @Get('lookup')
    @RequirePermissions(PERMISSIONS.SEGMENTS_READ)
    @ApiOperation({
        summary: 'Resolve segments by id',
        description:
            'For a caller holding ids rather than a page — the entry header chip, a revision’s captured access. Without it a paginated directory would leave those printing a uuid, or claiming an audience was deleted when it is merely on page three. Unknown ids are skipped, not refused.'
    })
    lookup(@Query() query: LookupSegmentsQueryDto): Promise<SegmentView[]> {
        return this.segments.byIds(query.ids);
    }

    /** One segment — what the editor page loads. */
    @Get(':id')
    @RequirePermissions(PERMISSIONS.SEGMENTS_READ)
    @ApiOperation({ summary: 'Read one segment' })
    get(@Param('id', ParseUUIDPipe) id: string): Promise<SegmentView> {
        return this.segments.get(id);
    }

    /** Create a segment. */
    @Post()
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.SEGMENTS_MANAGE)
    @ApiOperation({
        summary: 'Create a segment',
        description:
            'The reader tags default to the key, which is what an installation that never renames anything wants.'
    })
    create(
        @Body() body: CreateSegmentDto,
        @CurrentUser() user?: PublicUser
    ): Promise<SegmentView> {
        return this.segments.create({ ...body, actor: toActor(user) });
    }

    /** Rename a segment, or change the reader tags it answers to. */
    @Patch(':id')
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.SEGMENTS_MANAGE)
    @ApiOperation({
        summary: 'Update a segment',
        description:
            'Changing `tags` is what the segment indirection exists for: an identifier renamed upstream is one row edited here, and every entry that named the segment keeps working.'
    })
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateSegmentDto,
        @CurrentUser() user?: PublicUser
    ): Promise<SegmentView> {
        return this.segments.update(id, { ...body, actor: toActor(user) });
    }

    /** Delete a segment and drop it from every entry that named it. */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.SEGMENTS_MANAGE)
    @ApiOperation({
        summary: 'Delete a segment',
        description:
            'Also removes it from every entry’s allow and deny list, in one transaction. Leaving the id behind would leave entries governed by a segment that resolves to nobody — silently closing content on the allow side and opening it on the deny side.'
    })
    remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        return this.segments.remove(id, toActor(user));
    }
}

/**
 * The signed-in administrator as the {@link EventActor} a segments write stamps
 * onto its domain event, or `undefined` when there is nobody to name.
 */
function toActor(user?: PublicUser): EventActor | undefined {
    return user ? { id: user.id, email: user.email ?? null } : undefined;
}
