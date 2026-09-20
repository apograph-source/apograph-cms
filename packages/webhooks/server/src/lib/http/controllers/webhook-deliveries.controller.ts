import {
    Controller,
    Get,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import type { DeliveryStatus } from '@orthacms/webhooks-domain';
import { WebhookEndpointsService } from '../../application/webhook-endpoints.service';
import { ListDeliveriesQueryDto } from '../../application/dto/list-deliveries-query.dto';
import {
    WebhookDeliveryNotFoundError,
    WebhookEndpointNotFoundError
} from '../../domain/errors';
import type {
    WebhookDeliveryDetailView,
    WebhookDeliveryPage,
    WebhookDeliveryView
} from '../../domain/webhook-views';

/** Default rows per page when the caller does not say. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * The delivery log: `/api/webhooks/:id/deliveries`.
 *
 * Every route is scoped to the endpoint in the path, so a delivery id belonging
 * to another endpoint reads as "not found" rather than resolving — the log is
 * not a way to enumerate ids across endpoints.
 */
@ApiTags('webhooks')
@UseGuards(PermissionsGuard)
@Controller('webhooks/:id/deliveries')
export class WebhookDeliveriesController {
    constructor(private readonly endpoints: WebhookEndpointsService) {}

    /** One page of the endpoint's log, newest first. */
    @ApiOperation({
        summary: 'List webhook deliveries',
        description:
            'One page of the endpoint’s delivery log, newest first, ' +
            'optionally filtered by state or event kind.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_READ)
    @Get()
    async list(
        @Param('id', ParseUUIDPipe) endpointId: string,
        @Query() query: ListDeliveriesQueryDto
    ): Promise<WebhookDeliveryPage> {
        return this.run(() =>
            this.endpoints.listDeliveries(endpointId, {
                status: query.status as DeliveryStatus | undefined,
                eventKind: query.eventKind,
                page: query.page ?? 1,
                pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE
            })
        );
    }

    /** One delivery, with the body that was sent and the response. */
    @ApiOperation({
        summary: 'Get a webhook delivery',
        description:
            'The delivery with its frozen request body and the first couple ' +
            'of kilobytes of the response.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_READ)
    @Get(':deliveryId')
    async get(
        @Param('id', ParseUUIDPipe) endpointId: string,
        @Param('deliveryId', ParseUUIDPipe) deliveryId: string
    ): Promise<WebhookDeliveryDetailView> {
        return this.run(() =>
            this.endpoints.getDelivery(endpointId, deliveryId)
        );
    }

    /**
     * Queues the same event again.
     *
     * Needs `webhooks:manage`, not `webhooks:read`: it causes an outgoing
     * request to someone else's system, which is a write however it is spelled.
     */
    @ApiOperation({
        summary: 'Send a delivery again',
        description:
            'Queues a fresh delivery with the same body and the same event ' +
            'id, so a receiver that deduplicates still recognises the repeat.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_MANAGE)
    @UseGuards(OriginGuard)
    @Post(':deliveryId/redeliver')
    async redeliver(
        @Param('id', ParseUUIDPipe) endpointId: string,
        @Param('deliveryId', ParseUUIDPipe) deliveryId: string
    ): Promise<WebhookDeliveryView> {
        return this.run(() => this.endpoints.redeliver(endpointId, deliveryId));
    }

    /** Maps this plugin's not-found errors onto 404. */
    private async run<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (
                error instanceof WebhookEndpointNotFoundError ||
                error instanceof WebhookDeliveryNotFoundError
            ) {
                throw new NotFoundException(error.message);
            }
            throw error;
        }
    }
}
