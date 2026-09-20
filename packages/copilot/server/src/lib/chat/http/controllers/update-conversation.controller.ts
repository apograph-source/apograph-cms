import {
    BadRequestException,
    Body,
    Controller,
    Inject,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
    UseGuards
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { MODEL_REGISTRY, type ModelRegistry } from '@orthacms/copilot-domain';
import {
    CurrentUser,
    OriginGuard,
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
import {
    MODEL_CHOICE_DEFAULT,
    UpdateConversationDto
} from '../../application/dto/update-conversation.dto';

/**
 * `PATCH /api/copilot/conversations/:id` — rename a thread, file it away, bring
 * it back, or record the model picked for it.
 *
 * **Archiving is the only removal this API offers, and it is reversible.** A
 * thread's proposals are the receipts for changes that were actually made to
 * the caller's content (ADR-0009), so deleting a conversation would take the
 * only record of those edits with it. Hiding it from the list is the part
 * people want; destroying the audit trail is not, and if a hard delete is ever
 * added it needs to answer for the proposals first.
 *
 * A thread the caller doesn't own is a **404, not a 403** — the repository
 * filters on user and workspace and reports "not found" either way, so an id
 * cannot be probed for existence. `OriginGuard` because this changes state.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class UpdateConversationController {
    constructor(
        private readonly conversations: ConversationRepository,
        @Inject(MODEL_REGISTRY) private readonly models: ModelRegistry
    ) {}

    @Patch('conversations/:id')
    @UseGuards(OriginGuard)
    @ApiOperation({
        summary: 'Rename, archive, or set the model of a copilot conversation'
    })
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateConversationDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ConversationView> {
        // An empty patch cannot mean anything, and answering 200 to it would
        // report success for a write that never happened. The pipe cannot catch
        // this: every property is legitimately optional on its own.
        if (
            body.title === undefined &&
            body.archived === undefined &&
            body.modelChoice === undefined
        ) {
            throw new BadRequestException(
                'Provide a title, an archived flag, a model choice, or several.'
            );
        }

        if (body.modelChoice !== undefined) {
            this.assertKnownModel(body.modelChoice);
        }

        const updated = await this.conversations.update(
            id,
            user.id,
            workspaceId,
            {
                ...(body.title !== undefined ? { title: body.title } : {}),
                ...(body.archived !== undefined
                    ? { archived: body.archived }
                    : {}),
                ...(body.modelChoice !== undefined
                    ? { modelChoice: body.modelChoice }
                    : {})
            }
        );

        if (!updated) {
            throw new NotFoundException('Conversation not found.');
        }
        return updated;
    }

    /**
     * Refuses a choice that names no registered backend.
     *
     * The column is read back into the picker and offered as the next run's
     * `provider`/`model`, so an unchecked string is a value the user writes and
     * the UI then renders — and a run that would fail on a backend that does not
     * exist. Checking against `catalogue()` keeps the stored value inside what
     * the operator configured at boot, which is the same boundary the run route
     * enforces when a request names a provider.
     */
    private assertKnownModel(choice: string): void {
        if (choice === MODEL_CHOICE_DEFAULT) {
            return;
        }
        // The first colon only: a provider name cannot contain one, and a model
        // id routinely does (`llama3.1:8b`).
        const separator = choice.indexOf(':');
        const provider = separator > 0 ? choice.slice(0, separator) : '';
        const model = separator > 0 ? choice.slice(separator + 1) : '';
        const known = this.models
            .catalogue()
            .some(
                (entry) => entry.provider === provider && entry.model === model
            );
        if (!known) {
            throw new BadRequestException(
                'That model choice names no registered backend.'
            );
        }
    }
}
