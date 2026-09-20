import {
    Controller,
    Get,
    NotFoundException,
    Param,
    UseGuards
} from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '../../content.tokens';
import type { ContentTypeRegistry } from '../../registry/content-type-registry';
import { buildEntryFilterSurface } from '../../entries/infrastructure/queries/entry-filter-surface';
import type { FilterFieldsResponse } from '../../entries/types/filter-surface';
import { WorkspaceGrantsQuery } from '../queries/workspace-grants.query';

/**
 * `GET /api/content-schema/:name/filter-fields` — every scalar path the
 * records-table query builder may filter on: the type's own fields plus,
 * recursively within the relation-hop budget, its relations' fields
 * (`author.name`, `author.company.name`). This is the admin counterpart of
 * the SQL `FilterSchema` the list endpoint enforces — both come from a
 * single `buildEntryFilterSurface` traversal, so the picker can never offer
 * a path the API would reject with a 400.
 *
 * **Workspace-scoped**, unlike the sibling `/content-schema` routes (which
 * serve the global, code-defined type catalogue). The response describes
 * what *this* workspace may traverse, so it is pruned to the workspace's
 * `workspace_content` grants in two places:
 *
 * - the requested `:name` must itself be granted, else **404** — the same
 *   answer an unknown type gets, so the endpoint carries no signal about
 *   which types exist outside the caller's workspace;
 * - `grantedTypes` prunes the offered relations, mirroring the entry
 *   editor's `availableTypeNames`, so the picker never offers a traversal
 *   into a collection the caller cannot open.
 *
 * The SQL the list endpoint runs is workspace-scoped regardless, so this is
 * about not *disclosing* the shape of another workspace's content model,
 * not about row access.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('content-schema')
export class GetFilterFieldsController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery
    ) {}

    @Get(':name/filter-fields')
    async filterFields(
        @Param('name') name: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<FilterFieldsResponse> {
        const type = this.registry.get(name);
        // Resolve the grants before the registry check so an ungranted type
        // and an unknown one are indistinguishable — same status, same body,
        // same work done.
        const grantedTypes = await this.grants.grantedSlugs(workspaceId);
        if (!type || !grantedTypes.has(name)) {
            throw new NotFoundException(`Unknown content type "${name}".`);
        }
        const { fields } = buildEntryFilterSurface(type, {
            workspaceId,
            grantedTypes
        });
        return { fields };
    }
}
