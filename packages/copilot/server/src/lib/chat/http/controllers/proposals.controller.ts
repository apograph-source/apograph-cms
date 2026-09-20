import {
    Controller,
    Get,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Query,
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
    ProposalRepository,
    type ProposalView
} from '../../infrastructure/persistence/proposal.repository';
import { ConversationRepository } from '../../infrastructure/persistence/conversation.repository';
import { ListProposalsQueryDto } from '../../application/dto/list-proposals-query.dto';

/**
 * `GET /api/copilot/proposals…` — the record of what the copilot changed.
 *
 * **Reads only.** These used to sit alongside `accept` and `reject`, and this
 * was the accept boundary
 * ([ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §5).
 * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
 * removed the human step, so a proposal is now a **receipt** rather than a
 * decision waiting to be made: the engine applies it as it is drafted, and what
 * is left to serve is the row saying what happened.
 *
 * They are still worth serving, and both callers prove it: the chat panel joins
 * them onto a reopened thread so the cards come back, and the row is the paper
 * trail a change made without review depends on. Keeping the read while
 * deleting the write is the point — "undoable, never invisible" is now carried
 * entirely by this record.
 *
 * No `OriginGuard`: nothing here is state-changing any more.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class ProposalsController {
    constructor(
        private readonly proposals: ProposalRepository,
        private readonly conversations: ConversationRepository
    ) {}

    /**
     * The list is **workspace**-scoped, not user-scoped, and that is the right
     * shape: a proposal is the receipt for a change to the workspace's content,
     * and every member can already read that content. What it must not become
     * is a way to learn about someone else's *thread* — `GET
     * /conversations/:id` 404s a thread that is not yours, and a filter that
     * answered "yes, that id is in this workspace" would undo it from the other
     * side. So the filter is only honoured for a conversation the caller owns;
     * anything else is the same 404 the conversation route gives.
     */
    @Get('proposals')
    @ApiOperation({ summary: 'List the workspace’s copilot changes' })
    async list(
        @Query() query: ListProposalsQueryDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<{ items: ProposalView[] }> {
        if (query.conversationId) {
            const thread = await this.conversations.find(
                query.conversationId,
                user.id,
                workspaceId
            );
            if (!thread) {
                throw new NotFoundException(
                    `No conversation "${query.conversationId}".`
                );
            }
        }
        return {
            items: await this.proposals.list(workspaceId, {
                ...(query.status ? { status: query.status } : {}),
                ...(query.conversationId
                    ? { conversationId: query.conversationId }
                    : {})
            })
        };
    }

    @Get('proposals/:id')
    @ApiOperation({ summary: 'Read one copilot change' })
    async get(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ProposalView> {
        const proposal = await this.proposals.find(id, workspaceId);
        if (!proposal) {
            throw new NotFoundException(`No proposal "${id}".`);
        }
        return proposal;
    }
}
