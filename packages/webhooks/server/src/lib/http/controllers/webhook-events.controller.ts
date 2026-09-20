import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import {
    WEBHOOK_EVENTS,
    type WebhookEventDescriptor
} from '@orthacms/webhooks-domain';

/**
 * `GET /api/webhook-events` — the catalogue of subscribable event kinds.
 *
 * The admin's event picker is built from this rather than from a list compiled
 * into the SPA, so a deployment running a newer server offers the kinds that
 * server actually knows about. Same idea as `GET /api/content-schema`.
 */
@ApiTags('webhooks')
@UseGuards(PermissionsGuard)
@Controller('webhook-events')
export class WebhookEventsController {
    /** Every kind an endpoint may subscribe to. */
    @ApiOperation({
        summary: 'List subscribable webhook events',
        description:
            'The catalogue the endpoint editor’s event picker is built from.'
    })
    @RequirePermissions(PERMISSIONS.WEBHOOKS_READ)
    @Get()
    list(): readonly WebhookEventDescriptor[] {
        return WEBHOOK_EVENTS;
    }
}
