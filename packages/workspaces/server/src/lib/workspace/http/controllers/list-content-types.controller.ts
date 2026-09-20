import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequireAnyPermission
} from '@orthacms/identity-server';
import { ContentCatalogReader } from '../../application/content/content-catalog.reader';
import type { ContentTypeDescriptor } from '../../application/ports/content-type-descriptor';

/**
 * `GET /api/content-types` — lists every content type a workspace can be granted
 * access to.
 *
 * The catalogue is the input to a *grant* decision, so it is gated on being able
 * to make one. It has **two** callers, not one: the create wizard
 * (`workspaces:create`) and the settings content tab (`workspaces:update`), and
 * those are held by different roles — hence any-of rather than a single
 * permission, which would 403 whichever audience it left out.
 *
 * Backed by the content plugin's code-defined registry via the
 * {@link CONTENT_CATALOG} port; falls back to the built-in mock catalogue when
 * no content plugin is registered, so the workspace flow still works standalone.
 */
@UseGuards(PermissionsGuard)
@RequireAnyPermission(
    PERMISSIONS.WORKSPACES_CREATE,
    PERMISSIONS.WORKSPACES_UPDATE
)
@Controller('content-types')
export class ListContentTypesController {
    constructor(private readonly catalog: ContentCatalogReader) {}

    @Get()
    list(): readonly ContentTypeDescriptor[] {
        return this.catalog.list();
    }
}
