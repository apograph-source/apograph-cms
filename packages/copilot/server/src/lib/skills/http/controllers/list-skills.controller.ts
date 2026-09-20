import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import {
    SkillCatalogService,
    type SkillSummary
} from '../../application/skill-catalog.service';

/**
 * `GET /api/copilot/skills` — the catalogue the composer's picker renders.
 *
 * Gated on `copilot:use`, not on the manage permission: everybody who can chat
 * can attach a skill, and a picker that showed nothing to a contributor would
 * make the feature invisible to the people it is mostly for. What it does
 * **not** carry is `instructions` — see `SkillSummary` for why.
 *
 * `WorkspaceGuard` because the catalogue differs per workspace: code skills are
 * deployment-wide, CMS skills are not, and serving the union to an unvalidated
 * workspace id would leak one workspace's editorial guidance to another.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class ListSkillsController {
    constructor(private readonly catalog: SkillCatalogService) {}

    @Get('skills')
    @ApiOperation({
        summary: 'List the skills available in this workspace',
        description:
            'Code-defined skills first, then the workspace’s own enabled ones. ' +
            'Instruction bodies are not included.'
    })
    @ApiResponse({ status: 200, description: 'The available skills.' })
    async list(
        @CurrentWorkspace() workspaceId: string
    ): Promise<SkillSummary[]> {
        return this.catalog.catalogue(workspaceId);
    }
}
