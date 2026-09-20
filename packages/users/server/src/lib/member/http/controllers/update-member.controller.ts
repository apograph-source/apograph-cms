import {
    Body,
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
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
import { UpdateMemberDto } from '../../application/dto/update-member.dto';
import { UpdateMemberUseCase } from '../../application/use-cases/update-member.use-case';
import {
    MEMBER_ERROR_CODES,
    LastAdminProtectedError,
    MemberNotFoundError,
    SelfActionError
} from '../../domain/errors';
import { conflict } from '../conflict';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { MemberView } from '../../application/queries/member.view';

/**
 * `PATCH /api/users/:id` — edits a member's display name and/or role;
 * requires `users:update`. Changing your own role, and demoting the last
 * remaining active admin, are each rejected with a 409 (the UI disables the
 * control with the same rationale).
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_UPDATE)
@Controller('users')
export class UpdateMemberController {
    constructor(
        private readonly updateMember: UpdateMemberUseCase,
        private readonly views: MemberViewQuery
    ) {}

    @Patch(':id')
    async update(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateMemberDto
    ): Promise<MemberView> {
        try {
            await this.updateMember.execute(actor, id, body);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (error instanceof MemberNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof SelfActionError) {
                throw conflict(
                    MEMBER_ERROR_CODES.SELF_ACTION,
                    'You cannot change your own role'
                );
            }
            if (error instanceof LastAdminProtectedError) {
                throw conflict(
                    MEMBER_ERROR_CODES.LAST_ADMIN_PROTECTED,
                    'The last remaining admin cannot be demoted'
                );
            }
            throw error;
        }
    }
}
