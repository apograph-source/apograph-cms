import {
    Controller,
    Get,
    NotFoundException,
    Param,
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
import { EntryReviewService } from '../../application/entry-review.service';
import { UnknownProtectedContentTypeError } from '../../domain/errors';
import type { NewEntryProtectionView } from '../../types/protection-views';

/**
 * `GET /api/protection/types/:type` — what publishing a **new** entry of a type
 * would meet, for the caller.
 *
 * The create form's counterpart of `GET /protection/entries/:type/:id`. A form
 * with nothing saved has no entry id to read a review of, yet its Publish
 * button creates the entry and publishes it in one press — so without this the
 * editor could only find out a rule applies by having the publish refused
 * after the draft had already been written.
 *
 * `content:read`, for the reason the entry read gives: a contributor has to be
 * told that a new article needs an approval, and cannot read the rule table.
 * It says no more than that route already says about any existing entry of the
 * type.
 */
@ApiTags('protection')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('protection/types/:type')
export class NewEntryProtectionController {
    constructor(private readonly review: EntryReviewService) {}

    /** The requirement a new entry of this type would meet. */
    @ApiOperation({
        summary: 'Read what a new entry would need to publish',
        description:
            'Whether a rule is in force for this content type, and the ' +
            'verdict publishing a brand-new entry of it would meet for the ' +
            'caller — which has no approvals yet, by definition. 404 when the ' +
            'workspace was not granted the type, the same answer an unknown ' +
            'type gets.'
    })
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get()
    async forNewEntry(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @CurrentUser() user: PublicUser
    ): Promise<NewEntryProtectionView> {
        try {
            return await this.review.forNewEntry(
                workspaceId,
                type,
                await this.review.actorFor(user)
            );
        } catch (error) {
            if (error instanceof UnknownProtectedContentTypeError) {
                throw new NotFoundException(error.message);
            }
            throw error;
        }
    }
}
