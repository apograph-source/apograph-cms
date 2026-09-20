import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UnprocessableEntityException,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { WebhookUrlRejectedError } from '@orthacms/webhooks-domain';
import { WebhookEndpointsService } from '../../application/webhook-endpoints.service';
import { SaveWebhookEndpointDto } from '../../application/dto/save-webhook-endpoint.dto';
import { WebhookEndpointNotFoundError } from '../../domain/errors';
import type {
    WebhookEndpointView,
    WebhookTestResult
} from '../../domain/webhook-views';
import type { EndpointWriteModel } from '../../infrastructure/webhook-endpoint.repository';

/** An endpoint, plus the secret — the create and rotate responses only. */
interface EndpointWithSecretResponse {
    endpoint: WebhookEndpointView;
    secret: string;
}

/**
 * The endpoint surface: `/api/webhooks`.
 *
 * Global rather than workspace-scoped, so there is no `WorkspaceGuard` here:
 * an endpoint spans whichever workspaces it names, and which systems this
 * installation notifies is a deployment decision. Both permissions are
 * admin-only for the same reason — the rows hold a signing secret and reach
 * across every workspace.
 *
 * `OriginGuard` is applied per write route, matching content's and alarms'
 * controllers: these are cookie-authenticated and therefore CSRF-able, while
 * the reads change nothing.
 */
@ApiTags('webhooks')
@UseGuards(PermissionsGuard)
@Controller('webhooks')
export class WebhookEndpointsController {
    constructor(private readonly endpoints: WebhookEndpointsService) {}

    /** Every endpoint, newest first, each with its last delivery. */
    @ApiOperation({
        summary: 'List webhook endpoints',
        description:
            'Every configured endpoint with its filters and the outcome of ' +
            'its most recent delivery. Never includes the signing secret.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_READ)
    @Get()
    list(): Promise<WebhookEndpointView[]> {
        return this.endpoints.list();
    }

    /** One endpoint. */
    @ApiOperation({ summary: 'Get a webhook endpoint' })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_READ)
    @Get(':id')
    async get(
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<WebhookEndpointView> {
        return this.run(() => this.endpoints.get(id));
    }

    /**
     * Creates an endpoint and mints its signing secret.
     *
     * **This is the only response that ever contains the secret.** Every other
     * route returns `secretHint` instead, so a secret cannot be recovered by
     * anyone who missed it — including whoever created it.
     */
    @ApiOperation({
        summary: 'Create a webhook endpoint',
        description:
            'Creates the endpoint and returns its signing secret. The secret ' +
            'is shown once and is never returned again.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Post()
    async create(
        @Body() body: SaveWebhookEndpointDto,
        @CurrentUser() user: PublicUser
    ): Promise<EndpointWithSecretResponse> {
        return this.run(() =>
            this.endpoints.create(toWriteModel(body), user.id)
        );
    }

    /** Replaces an endpoint's configuration. */
    @ApiOperation({
        summary: 'Update a webhook endpoint',
        description:
            'Replaces the endpoint’s configuration. Re-enabling it by hand ' +
            'also clears an automatic disable and its failure count.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Patch(':id')
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SaveWebhookEndpointDto
    ): Promise<WebhookEndpointView> {
        return this.run(() => this.endpoints.update(id, toWriteModel(body)));
    }

    /** Deletes the endpoint and its delivery log. */
    @ApiOperation({
        summary: 'Delete a webhook endpoint',
        description: 'Deletes the endpoint and, with it, its delivery log.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Delete(':id')
    @HttpCode(204)
    async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
        await this.run(() => this.endpoints.delete(id));
    }

    /** Rotates the signing secret and returns the new one, once. */
    @ApiOperation({
        summary: 'Rotate a webhook signing secret',
        description:
            'Mints a new signing secret and returns it once. It takes effect ' +
            'immediately, including for deliveries already queued, so the ' +
            'receiver needs it in place before rotating.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Post(':id/secret')
    async rotateSecret(
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<EndpointWithSecretResponse> {
        return this.run(() => this.endpoints.rotateSecret(id));
    }

    /**
     * Sends a synthetic `ping` and reports the result.
     *
     * Synchronous and unqueued: the person who pressed the button is waiting,
     * and it does not count against the endpoint's failure budget.
     */
    @ApiOperation({
        summary: 'Send a test delivery',
        description:
            'Posts a synthetic `ping` event and reports the response. It is ' +
            'not queued and does not count towards automatic disabling.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Post(':id/test')
    @HttpCode(200)
    async test(
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<WebhookTestResult> {
        return this.run(() => this.endpoints.sendTest(id));
    }

    /**
     * Maps this plugin's domain errors onto HTTP.
     *
     * A rejected URL is a 422 rather than a 400 because the request was
     * well-formed and the value was refused by policy — and the message is
     * written to be shown in the form that produced it.
     */
    private async run<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof WebhookEndpointNotFoundError) {
                throw new NotFoundException(error.message);
            }
            if (error instanceof WebhookUrlRejectedError) {
                throw new UnprocessableEntityException(error.message);
            }
            throw error;
        }
    }
}

/**
 * DTO → the repository's write model, resolving what an omitted field means.
 *
 * Every default here says "everything": an omitted filter is not an empty
 * subscription, it is an unfiltered one. The one exception is `allWorkspaces`,
 * which defaults to false — "all workspaces" reaches across tenants and should
 * be something someone chose, not something they forgot to say.
 */
function toWriteModel(dto: SaveWebhookEndpointDto): EndpointWriteModel {
    const allWorkspaces = dto.allWorkspaces ?? false;
    return {
        name: dto.name.trim(),
        url: dto.url.trim(),
        enabled: dto.enabled ?? true,
        eventKinds: dto.eventKinds ?? [],
        contentTypes: dto.contentTypes ?? [],
        allWorkspaces,
        workspaceIds: allWorkspaces ? [] : (dto.workspaceIds ?? []),
        headers: dto.headers ?? {}
    };
}
