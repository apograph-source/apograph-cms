import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards
} from '@nestjs/common';
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
    type ConversationView,
    type MessageView
} from '../../infrastructure/persistence/conversation.repository';

/** A thread plus its transcript. */
export interface ConversationDetail {
    conversation: ConversationView;
    messages: MessageView[];
}

/**
 * `GET /api/copilot/conversations/:id` — one thread and its transcript, so a
 * reopened panel or a reloaded tab renders what was persisted rather than only
 * what streamed.
 *
 * A thread the caller doesn't own is a **404, not a 403** — the repository
 * filters on user and workspace and reports "not found" either way, so an id
 * cannot be probed for existence.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class GetConversationController {
    constructor(private readonly conversations: ConversationRepository) {}

    @Get('conversations/:id')
    @ApiOperation({
        summary: 'Get one copilot conversation and its transcript'
    })
    async get(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ConversationDetail> {
        const conversation = await this.conversations.findOrFail(
            id,
            user.id,
            workspaceId
        );
        return {
            conversation,
            messages: await this.conversations.messages(conversation.id)
        };
    }
}
