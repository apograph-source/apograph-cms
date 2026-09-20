import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { InjectContentRegistry } from '../../content.tokens';
import type {
    ContentTypeRegistry,
    SerializedContentTypeSummary
} from '../../registry/content-type-registry';

/**
 * `GET /api/content-schema` — summaries of every code-defined content
 * type (collections and singles). Shape-compatible with identity's
 * `ContentTypeDescriptor`, so once identity's workspace grants consume
 * this registry, its mock `/api/content-types` retires in favor of this
 * source of truth. Authentication is enforced by the app-wide AuthGuard;
 * read access is gated on `content:read`.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('content-schema')
export class ListContentSchemaController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry
    ) {}

    @Get()
    list(): SerializedContentTypeSummary[] {
        return this.registry.summaries();
    }
}
