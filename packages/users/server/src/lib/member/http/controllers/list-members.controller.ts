import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { ListMembersQueryDto } from '../../application/dto/list-members-query.dto';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { MemberListView } from '../../application/queries/member.view';

/**
 * `GET /api/users` — one searchable, paginated page of members. Authentication
 * comes from identity's global `AuthGuard`; authorization is `users:read`,
 * which every seeded role holds, so any signed-in member can view the roster
 * (emails included — consistent with the workspaces read surface).
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_READ)
@Controller('users')
export class ListMembersController {
    constructor(private readonly views: MemberViewQuery) {}

    @Get()
    list(@Query() query: ListMembersQueryDto): Promise<MemberListView> {
        return this.views.list(query);
    }
}
