import {
    Body,
    ConflictException,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UnprocessableEntityException,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { EntryReviewService } from '../../application/entry-review.service';
import { RequestReviewDto } from '../../application/dto/request-review.dto';
import { NoBodyDto } from '../../application/dto/no-body.dto';
import {
    ReviewableEntryNotFoundError,
    ReviewerNotEligibleError,
    ReviewRequestNotFoundError,
    ReviewRequestNotYoursError,
    SelfApprovalRefusedError
} from '../../domain/errors';
import type {
    EntryReviewView,
    ReviewerCandidatesView
} from '../../types/protection-views';

/**
 * The review surface: `/api/protection/entries/:type/:id`.
 *
 * Under `/api/protection`, not `/api/content` — protection is a policy *about*
 * content that content knows nothing of, and a plugin hanging its routes off
 * another's prefix makes that prefix ambiguous to read and to guard.
 *
 * **The read is `content:read`, not `protection:manage`.** That asymmetry is the
 * point of the permission split: `protection:manage` is administrator-only and
 * covers the workspace's rule *table*, while a contributor still has to see
 * "0 of 2" on the entry they are editing. The rule is configuration; this is the
 * entry's own state.
 *
 * The writes split two ways. Asking for review is `content:update` — it is
 * something the author of the entry does. Approving is `content:approve`, which
 * contributor and admin hold and viewer does not, because approving is an
 * editorial act. And **no API token holds `content:approve` at all**
 * (`protection:I-12`): a token names nobody, so a vote from one would satisfy
 * the count while the guarantee it stands for — that a second person read the
 * thing — quietly does not hold.
 */
@ApiTags('protection')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('protection/entries/:type/:id')
export class EntryReviewController {
    constructor(private readonly review: EntryReviewService) {}

    /** The entry's review state — the numbers, the voters, the open ask. */
    @ApiOperation({
        summary: 'Read an entry’s review state',
        description:
            'The effective requirement, every vote with its staleness, and ' +
            'the open request. Readable with `content:read`: the editor has ' +
            'to render “0 of 2” for a contributor, who cannot read the ' +
            'workspace’s rule table. 404 when the entry is not reachable from ' +
            'this workspace under this content type — the same answer an ' +
            'unknown type gets, so one workspace cannot probe another’s ids.'
    })
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get()
    state(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser
    ): Promise<EntryReviewView> {
        return mapErrors(async () =>
            this.review.state(
                workspaceId,
                type,
                id,
                await this.review.actorFor(user)
            )
        );
    }

    /** Who the caller may ask to review. */
    @ApiOperation({
        summary: 'List who can be asked to review',
        description:
            'The members of this workspace holding `content:approve`, other ' +
            'than the caller — exactly the people the request route accepts. ' +
            '`content:update`, the permission asking for review takes.'
    })
    @RequirePermissions(PERMISSIONS.CONTENT_UPDATE)
    @Get('reviewers')
    async reviewers(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser
    ): Promise<ReviewerCandidatesView> {
        return mapErrors(async () => ({
            candidates: await this.review.reviewerCandidates(
                workspaceId,
                type,
                id,
                await this.review.actorFor(user)
            )
        }));
    }

    /** Ask named people to look at the entry. */
    @ApiOperation({
        summary: 'Request review',
        description:
            'Opens the request naming who is asked, or replaces the reviewers ' +
            'on the one already open — asking twice is an update, not a ' +
            'conflict. The request survives later saves: what a save ' +
            'invalidates is an **approval**, not the ask. Who is asked never ' +
            'changes whose approval counts. `422 ' +
            '`protection.reviewer_not_eligible`` when a reviewer is not ' +
            'another member who can approve. Allowed on an unprotected type, ' +
            'which simply never blocks.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.CONTENT_UPDATE)
    @Post('request')
    @HttpCode(201)
    async request(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: RequestReviewDto,
        @CurrentUser() user: PublicUser
    ): Promise<void> {
        await mapErrors(async () =>
            this.review.requestReview(
                workspaceId,
                type,
                id,
                body.reviewerIds,
                await this.review.actorFor(user)
            )
        );
    }

    /** Withdraw the open request. */
    @ApiOperation({
        summary: 'Withdraw a review request',
        description:
            'The requester’s to withdraw, or an administrator’s — a reviewer ' +
            'who thinks it premature declines to approve instead. The row is ' +
            'resolved rather than deleted, so the trail keeps that it was ' +
            'asked for.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.CONTENT_UPDATE)
    @HttpCode(204)
    @Delete('request')
    async withdrawRequest(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser
    ): Promise<void> {
        await mapErrors(async () =>
            this.review.withdrawRequest(
                workspaceId,
                type,
                id,
                await this.review.actorFor(user)
            )
        );
    }

    /** Approve the entry's current version. */
    @ApiOperation({
        summary: 'Approve an entry',
        description:
            'Records the caller’s approval **of the current revision**, ' +
            'idempotently. The next save leaves it off ' +
            'the head with no dismissal logic. `409 ' +
            '`protection.self_approval_refused`` when the rule requires ' +
            'somebody else and the caller wrote the head — administrators ' +
            'included, since that is the review the rule is bought to force.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.CONTENT_APPROVE)
    @Post('approve')
    @HttpCode(201)
    async approve(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        // Declared only so a `note` is refused rather than dropped.
        @Body() _body: NoBodyDto,
        @CurrentUser() user: PublicUser
    ): Promise<void> {
        await mapErrors(async () =>
            this.review.approve(
                workspaceId,
                type,
                id,
                await this.review.actorFor(user)
            )
        );
    }

    /** Take back the caller's own vote. */
    @ApiOperation({
        summary: 'Withdraw your own vote',
        description:
            'Removes the caller’s vote on the **current** revision only. A ' +
            'vote on an earlier version is already not counting, and deleting ' +
            'it would erase the struck-through line that explains why the ' +
            'number moved. Idempotent.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.CONTENT_APPROVE)
    @HttpCode(204)
    @Delete('approve')
    async withdrawVote(
        @CurrentWorkspace() workspaceId: string,
        @Param('type') type: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser
    ): Promise<void> {
        await mapErrors(async () =>
            this.review.withdrawVote(
                workspaceId,
                type,
                id,
                await this.review.actorFor(user)
            )
        );
    }
}

/**
 * Maps the domain errors to HTTP.
 *
 * The **409** for a self-approval is the interesting one. A 403 would be wrong
 * and actively misleading: the caller does hold `content:approve` and the route
 * is theirs to call — what refuses them is the state of this entry, and a 403
 * would send them asking an administrator for a permission they already have.
 */
async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (
            error instanceof ReviewableEntryNotFoundError ||
            error instanceof ReviewRequestNotFoundError
        ) {
            throw new NotFoundException(error.message);
        }
        if (error instanceof ReviewRequestNotYoursError) {
            throw new ForbiddenException(error.message);
        }
        if (error instanceof ReviewerNotEligibleError) {
            throw new UnprocessableEntityException({
                statusCode: 422,
                code: 'protection.reviewer_not_eligible',
                message: error.message
            });
        }
        if (error instanceof SelfApprovalRefusedError) {
            throw new ConflictException({
                statusCode: 409,
                code: 'protection.self_approval_refused',
                message: error.message
            });
        }
        throw error;
    }
}
