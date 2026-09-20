import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
    CurrentUser,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import {
    ConversationRepository,
    type ConversationView
} from '../../infrastructure/persistence/conversation.repository';
import { ListConversationsQueryDto } from '../../application/dto/list-conversations-query.dto';

/**
 * `GET /api/copilot/conversations` — the signed-in user's threads in the open
 * workspace, most recently used first.
 *
 * No `OriginGuard`: it guards state-changing requests, and this reads. The
 * scoping that matters is in the repository, which filters on user **and**
 * workspace — the guard proves the caller belongs to the workspace, and the
 * query proves the threads belong to the caller.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class ListConversationsController {
    constructor(private readonly conversations: ConversationRepository) {}

    @Get('conversations')
    @ApiOperation({ summary: 'List the current user’s copilot conversations' })
    async list(
        @Query() query: ListConversationsQueryDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<{ items: ConversationView[] }> {
        return {
            items: await this.conversations.list(
                user.id,
                workspaceId,
                query.archived ?? false
            )
        };
    }
}
