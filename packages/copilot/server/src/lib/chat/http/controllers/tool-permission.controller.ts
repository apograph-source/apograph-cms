import {
    Body,
    Controller,
    HttpCode,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@apograph/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@apograph/workspaces-server';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import { toolPermissionEvent } from '../../../copilot.events';
import { ToolPermissionBroker } from '../../application/tool-permission.broker';
import { DecideToolPermissionDto } from '../../application/dto/decide-tool-permission.dto';
import { ExtendToolPermissionDto } from '../../application/dto/extend-tool-permission.dto';

/**
 * `POST /api/copilot/runs/:runId/permission` — the answer to a parked run.
 *
 * **A second request against a run that is still streaming**, which is the only
 * shape available: the run is an SSE response, and a response cannot be asked
 * questions. The run yields a `tool-permission-request` carrying its `runId`
 * and the call id, and this route resolves the promise it is awaiting.
 *
 * It intentionally does **not** re-check whether the caller may use the tool.
 * That is not a gap: the offer filtered it, and `executeTool` re-authorizes
 * against freshly resolved grants immediately after this returns. What this
 * route decides is whether the user *wants* the call to happen, which is a
 * different question from whether they are allowed to make it — and answering
 * "yes" to a tool their role has since lost still ends in a refusal downstream.
 *
 * It very much **does** check whose run it is, and the guards above cannot do
 * it for us. `copilot:use` is held by every role including viewers, and
 * `WorkspaceGuard` proves the caller belongs to *the workspace they named* —
 * neither says anything about the run. Without the owner check a colleague
 * could allow (or refuse) a write in someone else's chat, and a member of an
 * unrelated workspace could do it by naming their own: the `runId` is not a
 * secret, it is handed to the client in the `run-started` frame.
 *
 * The 404 is load-bearing rather than cosmetic, and it is deliberately the same
 * answer for "nothing is waiting" and "not yours". Nothing waiting means the
 * decision arrived after the timeout, or the run is parked on another instance
 * (the broker is in-memory — see its notes). Both are worth telling the client
 * about, because in both cases the answer it just gave had no effect — and
 * whether someone else's run exists is not information this route hands out.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class ToolPermissionController {
    constructor(
        private readonly broker: ToolPermissionBroker,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    @Post('runs/:runId/permission')
    @HttpCode(204)
    @UseGuards(OriginGuard)
    @ApiOperation({
        summary: 'Allow or refuse one tool call in a running turn'
    })
    async decide(
        @Param('runId', ParseUUIDPipe) runId: string,
        @Body() body: DecideToolPermissionDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<void> {
        const delivered = this.broker.decide(
            runId,
            body.callId,
            body.decision,
            {
                userId: user.id,
                workspaceId
            }
        );
        if (!delivered) {
            throw new NotFoundException(
                'That request is no longer waiting for an answer.'
            );
        }

        // Recorded only when the decision was actually **delivered** — a late
        // answer to a run that already gave up had no effect, and a row for it
        // would report authority that was never granted. Same rule the outbox
        // producers follow everywhere: audit what happened, not what was asked.
        //
        // This is the moment a person hands the agent authority it did not
        // otherwise hold. The run's transcript records it too, but a transcript
        // is a conversation the author can delete, not an audit store.
        await this.uow.run(() =>
            this.outbox.append(
                attachActor(
                    [
                        toolPermissionEvent(runId, {
                            workspaceId,
                            callId: body.callId,
                            decision: body.decision
                        })
                    ],
                    { id: user.id, email: user.email ?? null }
                )
            )
        );
    }

    /**
     * `POST /api/copilot/runs/:runId/permission/extend` — "I need more time".
     *
     * The prompt used to have a five-minute limit with no warning, no countdown
     * and no way to ask for longer: it simply disappeared, and the model
     * reported that nobody had answered. WCAG 2.2.1 requires that a time limit
     * set by the content can be turned off, adjusted, or **extended after a
     * warning** — and none of its exceptions apply here, since
     * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
     * justifies the limit as cost, not correctness (`ORT-118`).
     *
     * Same guards, same ownership check and same 404 as {@link decide}: this
     * grants time on a parked run, so who may ask is exactly who may answer.
     */
    @Post('runs/:runId/permission/extend')
    @UseGuards(OriginGuard)
    @ApiOperation({
        summary: 'Give the user more time to answer a parked tool call'
    })
    extend(
        @Param('runId', ParseUUIDPipe) runId: string,
        @Body() body: ExtendToolPermissionDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): { expiresAt: string } {
        const grantedMs = this.broker.extend(runId, body.callId, {
            userId: user.id,
            workspaceId
        });
        if (grantedMs === null) {
            throw new NotFoundException(
                'That request is no longer waiting for an answer.'
            );
        }
        return { expiresAt: new Date(Date.now() + grantedMs).toISOString() };
    }
}
