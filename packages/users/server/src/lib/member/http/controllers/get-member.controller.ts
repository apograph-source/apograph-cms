import {
    Controller,
    Get,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    UseGuards
} from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { MemberView } from '../../application/queries/member.view';

/**
 * `GET /api/users/:id` — one member's full view (role + workspaces +
 * `isLastAdmin`), backing the user detail page. Authorization is `users:read`,
 * matching the roster listing. An unknown id is a 404; we never leak whether
 * the id format simply failed to match a row vs. an unauthorized peek, since
 * the read surface is open to every signed-in member anyway.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_READ)
@Controller('users')
export class GetMemberController {
    constructor(private readonly views: MemberViewQuery) {}

    @Get(':id')
    async get(@Param('id', ParseUUIDPipe) id: string): Promise<MemberView> {
        const view = await this.views.byId(id);
        if (!view) {
            throw new NotFoundException();
        }
        return view;
    }
}
