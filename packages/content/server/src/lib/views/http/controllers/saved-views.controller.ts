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
    Put,
    Query,
    UnauthorizedException,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    CurrentUser,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import type { SavedView } from '../../domain/saved-view';
import { VIEW_VISIBILITY } from '../../domain/saved-view';
import { SavedViewsQuery } from '../../application/queries/saved-views.query';
import { CreateSavedViewUseCase } from '../../application/use-cases/create-saved-view.use-case';
import { UpdateSavedViewUseCase } from '../../application/use-cases/update-saved-view.use-case';
import { DeleteSavedViewUseCase } from '../../application/use-cases/delete-saved-view.use-case';
import { SetDefaultViewUseCase } from '../../application/use-cases/set-default-view.use-case';
import { ViewScopeService } from '../../application/view-scope.service';
import {
    CreateViewDto,
    ListViewsQueryDto,
    UpdateViewDto
} from '../dto/save-view.dto';
import { toHttpError } from './to-http-error';

/**
 * `/api/views` — a member's saved list views for one content type.
 *
 * A genuine CRUD resource over one thing, so it stays a single controller
 * rather than five. Every route is workspace-scoped (`WorkspaceGuard` reads
 * `X-Workspace-Id` and 403s a non-member) and gated on `content:read`: a view
 * is a saved way of reading content, so anyone who cannot read content has no
 * use for one. Sharing needs `views:share` on top, checked per write because it
 * depends on the *body*, not the route.
 *
 * The stored payload is **not** a grant. It is replayed through the ordinary
 * list query with the reader's own permissions, workspace scope and content
 * grants, so a shared view shows a narrower reader fewer rows — never more.
 */
@ApiTags('views')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('views')
export class SavedViewsController {
    constructor(
        private readonly views: SavedViewsQuery,
        private readonly scopes: ViewScopeService,
        private readonly createView: CreateSavedViewUseCase,
        private readonly updateView: UpdateSavedViewUseCase,
        private readonly deleteView: DeleteSavedViewUseCase,
        private readonly setDefault: SetDefaultViewUseCase
    ) {}

    /** Every view this member may see for a list: their own plus the shared ones. */
    @ApiOperation({
        summary: 'List the saved views for one content type',
        description:
            'Returns the caller’s own views at any visibility plus every workspace-shared view for the scope, ordered for the switcher.'
    })
    @Get()
    async list(
        @Query() query: ListViewsQueryDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<SavedView[]> {
        const actor = requireUser(user);
        await this.scopes.assertReachable(query.scope, workspaceId);
        return this.views.list(workspaceId, query.scope, actor.id);
    }

    /** Saves the current slice as a new view. */
    @ApiOperation({
        summary: 'Save a new view',
        description:
            'Stores the filter/sort/columns slice under a name. `visibility: workspace` additionally requires `views:share`.'
    })
    @Post()
    async create(
        @Body() body: CreateViewDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<SavedView> {
        const actor = requireUser(user);
        await this.scopes.assertReachable(body.scope, workspaceId);
        try {
            return await this.createView.execute(
                {
                    workspaceId,
                    scope: body.scope,
                    name: body.name,
                    visibility: body.visibility ?? VIEW_VISIBILITY.Private,
                    payload: body.payload,
                    makeDefault: body.makeDefault
                },
                actor
            );
        } catch (error) {
            toHttpError(error);
        }
    }

    /** Renames, re-shares, or re-captures a view the caller owns. */
    @ApiOperation({
        summary: 'Update a saved view',
        description:
            'Owner-only. Send just the fields that change — `payload` on Save, `name` on a rename, `visibility` on share/unshare.'
    })
    @Patch(':id')
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateViewDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<SavedView> {
        const actor = requireUser(user);
        try {
            return await this.updateView.execute(id, workspaceId, body, actor);
        } catch (error) {
            toHttpError(error);
        }
    }

    /** Deletes a view the caller owns. */
    @ApiOperation({
        summary: 'Delete a saved view',
        description:
            'Owner-only. Any member’s default pointing at it is cleared by the cascade.'
    })
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const actor = requireUser(user);
        try {
            await this.deleteView.execute(id, workspaceId, actor);
        } catch (error) {
            toHttpError(error);
        }
    }

    /** Lands this member on the view when they open the list. */
    @ApiOperation({
        summary: 'Make a view the caller’s default',
        description:
            'Not owner-gated: a default is the reader’s own landing choice, so any view they can see may be one.'
    })
    @Put(':id/default')
    @HttpCode(HttpStatus.NO_CONTENT)
    async makeDefault(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const actor = requireUser(user);
        try {
            await this.setDefault.execute(id, workspaceId, actor);
        } catch (error) {
            toHttpError(error);
        }
    }

    /** Clears the caller's default, so the list opens unfiltered again. */
    @ApiOperation({
        summary: 'Clear the caller’s default view',
        description:
            'The list then opens with no filter. Idempotent — clearing an absent default succeeds.'
    })
    @Delete(':id/default')
    @HttpCode(HttpStatus.NO_CONTENT)
    async clearDefault(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const actor = requireUser(user);
        try {
            await this.setDefault.executeClear(id, workspaceId, actor);
        } catch (error) {
            toHttpError(error);
        }
    }
}

/**
 * Narrows the optional `@CurrentUser()` to a present one. Every route here is
 * behind the app-wide `AuthGuard`, so this cannot fire in practice — it exists
 * so the use-cases take a `PublicUser` rather than an optional one.
 */
function requireUser(user: PublicUser | undefined): PublicUser {
    if (!user) throw new UnauthorizedException();
    return user;
}
