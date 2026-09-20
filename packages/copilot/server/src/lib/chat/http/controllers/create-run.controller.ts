import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Logger,
    Post,
    Res,
    UseGuards
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { CreateRunDto } from '../../application/dto/create-run.dto';
import {
    AttachmentError,
    CopilotDisabledError,
    RunEngine,
    UnknownModelChoiceError
} from '../../application/run-engine.service';
import { UnknownModelError } from '@orthacms/copilot-domain';
import { ContentTypeSummaryService } from '../../application/content-type-summary.service';
import { SkillResolutionError } from '../../../skills/application/skill-catalog.service';
import { SseStream } from '../sse-stream';

/**
 * `POST /api/copilot/runs` — starts a turn and streams it back as Server-Sent
 * Events (`docs/design/copilot.md` §5).
 *
 * **Every guard is explicit, and that is the point.** Only `AuthGuard` is
 * global (`APP_GUARD`); `OriginGuard`, `PermissionsGuard` and `WorkspaceGuard`
 * are per-controller decorators, so a copilot route that forgot
 * `WorkspaceGuard` would authenticate fine, pass its permission check, and then
 * run every tool with an **unvalidated** workspace id taken straight from a
 * client header — silently unscoping the whole tool catalogue. The three below
 * are, in order: reject cross-site POSTs, require `copilot:use`, and prove the
 * caller is a member of the workspace they named.
 *
 * SSE on a POST rather than a GET + `EventSource`, because the turn has a body
 * (the message and its context) and `EventSource` cannot send one. Verified to
 * stream unbuffered through the admin's Vite dev proxy.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class CreateRunController {
    private readonly logger = new Logger(CreateRunController.name);

    constructor(
        private readonly engine: RunEngine,
        private readonly types: ContentTypeSummaryService
    ) {}

    @Post('runs')
    // The response is written by hand, so Nest must not also send one.
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Start a copilot run',
        description:
            'Streams the run back as Server-Sent Events: `run-started`, then any ' +
            'number of `text-delta` / `tool-call` / `tool-result` frames, then exactly ' +
            'one `done`. An `error` frame may precede `done`.'
    })
    @ApiBody({ type: CreateRunDto })
    @ApiResponse({
        status: 200,
        description: 'An event stream (`text/event-stream`).'
    })
    async create(
        @Body() body: CreateRunDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string,
        @Res() res: Response
    ): Promise<void> {
        const stream = new SseStream(res);
        const abort = new AbortController();
        // Wired before the first await: a client that gives up during setup
        // must still cancel the run.
        stream.onClientDisconnect(abort);

        const typeSummaries = await this.types.summaries(workspaceId);

        stream.open();
        try {
            const events = this.engine.run({
                userId: user.id,
                userEmail: user.email,
                roleId: user.roleId,
                workspaceId,
                conversationId: body.conversationId,
                message: body.message,
                ...(body.attachments?.length
                    ? {
                          attachments: body.attachments.map(
                              (attachment) => attachment.assetId
                          )
                      }
                    : {}),
                ...(body.skills?.length
                    ? { skills: body.skills.map((skill) => skill.name) }
                    : {}),
                context: body.context ?? {},
                uiLocale: body.uiLocale ?? 'en',
                ...(body.provider || body.model
                    ? {
                          choice: {
                              ...(body.provider
                                  ? { provider: body.provider }
                                  : {}),
                              ...(body.model ? { model: body.model } : {})
                          }
                      }
                    : {}),
                typeSummaries,
                signal: abort.signal
            });

            for await (const event of events) {
                stream.send(event);
            }
        } catch (error) {
            // The headers went out with `stream.open()`, so an error here can
            // no longer become a status code — rethrowing would hand Nest's
            // exception filter a response it cannot write to. It has to arrive
            // as a frame instead, and be logged here rather than by the filter.
            if (error instanceof CopilotDisabledError) {
                stream.send({
                    type: 'error',
                    message:
                        'Ortha AI is turned off for this deployment. An administrator can enable it.'
                });
            } else if (
                error instanceof AttachmentError ||
                error instanceof SkillResolutionError ||
                error instanceof UnknownModelChoiceError ||
                error instanceof UnknownModelError
            ) {
                // A bad attachment, an unavailable skill or a bad
                // provider/model is the caller's
                // mistake, and its own
                // message already names what was asked for and what exists —
                // far more useful than a generic failure, and safe to show
                // because the catalogue is public to anyone with `copilot:use`.
                stream.send({ type: 'error', message: error.message });
            } else {
                this.logger.error(
                    'Copilot run failed after the stream was opened',
                    error instanceof Error ? error.stack : String(error)
                );
                stream.send({
                    type: 'error',
                    message: 'Ortha AI could not complete this run.'
                });
            }
            // Always terminate with `done`, whatever went wrong: the client's
            // reducer keys "the turn is over" off this one frame, and a stream
            // that just stops would leave the UI spinning forever.
            stream.send({
                type: 'done',
                stopReason: 'error',
                usage: { inputTokens: 0, outputTokens: 0 }
            });
        } finally {
            stream.close();
        }
    }
}
