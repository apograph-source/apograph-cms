import {
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { SetMemberStatusUseCase } from '../../application/use-cases/set-member-status.use-case';
import {
    MEMBER_ERROR_CODES,
    InvalidMemberStateError,
    LastAdminProtectedError,
    MemberNotFoundError,
    SelfActionError
} from '../../domain/errors';
import { conflict } from '../conflict';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { MemberView } from '../../application/queries/member.view';

/**
 * `POST /api/users/:id/disable` and `POST /api/users/:id/enable` — flips a
 * member's account between active and disabled; requires `users:update`.
 * One controller for the pair: they are the same use case (status), share
 * every dependency, and mirror each other's error mapping. Self-disable and
 * disabling the last active admin are rejected with a 409.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_UPDATE)
@Controller('users')
export class SetMemberStatusController {
    constructor(
        private readonly setStatus: SetMemberStatusUseCase,
        private readonly views: MemberViewQuery
    ) {}

    @Post(':id/disable')
    async disable(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<MemberView> {
        try {
            await this.setStatus.disable(actor, id);
            return await this.viewOf(id);
        } catch (error) {
            throw mapStatusError(error);
        }
    }

    @Post(':id/enable')
    async enable(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<MemberView> {
        try {
            await this.setStatus.enable(actor, id);
            return await this.viewOf(id);
        } catch (error) {
            throw mapStatusError(error);
        }
    }

    /** Reads the fresh view after a status change, 404ing a vanished member. */
    private async viewOf(id: string): Promise<MemberView> {
        const view = await this.views.byId(id);
        if (!view) {
            throw new NotFoundException();
        }
        return view;
    }
}

/** Maps the status-change domain errors to HTTP; re-throws the rest. */
function mapStatusError(error: unknown): Error {
    if (error instanceof NotFoundException) {
        return error;
    }
    if (error instanceof MemberNotFoundError) {
        return new NotFoundException();
    }
    if (error instanceof SelfActionError) {
        return conflict(
            MEMBER_ERROR_CODES.SELF_ACTION,
            'You cannot disable your own account'
        );
    }
    if (error instanceof LastAdminProtectedError) {
        return conflict(
            MEMBER_ERROR_CODES.LAST_ADMIN_PROTECTED,
            'The last remaining admin cannot be disabled'
        );
    }
    if (error instanceof InvalidMemberStateError) {
        return conflict(error.code, error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
}
