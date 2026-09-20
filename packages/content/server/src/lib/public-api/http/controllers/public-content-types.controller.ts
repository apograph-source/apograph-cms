import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import {
    PERMISSIONS,
    Public,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '../../../content.tokens';
import type {
    ContentTypeRegistry,
    SerializedContentType,
    SerializedContentTypeSummary
} from '../../../registry/content-type-registry';
import { WorkspaceGrantsQuery } from '../../../content-types/queries/workspace-grants.query';
import { ApiTokenGuard } from '../guards/api-token.guard';
import { ApiTokenWorkspaceGuard } from '../guards/api-token-workspace.guard';
import { resolveGrantedType } from './resolve-granted-type';

/** The discovery list: every type this token's workspace can be read for. */
export interface PublicContentTypeListView {
    items: SerializedContentTypeSummary[];
}

/**
 * `GET /api/v1/content-types` — the **schema-discovery** half of the public
 * API. A consumer asks what it can read and how each type is shaped, instead of
 * hard-coding a model it can't see.
 *
 * Both routes are **pruned to the workspace's content grants**, and so is
 * `/v1/content/:typeName` — so the discovery list is exactly the set of names
 * that will not 404, and a token can't enumerate types its workspace doesn't
 * expose.
 *
 * The field schema is served whole, including relation fields. Those describe
 * the real model even though the entry read is flat: an owning single relation
 * appears in `values` as the target's raw id (follow it with a second read),
 * while a many-relation and an inverse carry no value in a public entry at all.
 */
@Public()
@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@ApiSecurity('apiToken')
@ApiHeader({
    name: 'X-Workspace-Id',
    required: false,
    description:
        "The workspace whose grants scope the result. Required when the token covers more than one workspace; optional when it covers exactly one. A workspace outside the token's bucket is a 403."
})
@Controller('v1/content-types')
export class PublicContentTypesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery
    ) {}

    /** `GET /api/v1/content-types` — summaries of every readable type. */
    @Get()
    @ApiOperation({
        summary: 'List the content types this token can read',
        description:
            'Summaries (name, kind, label, and the publishable/paranoid/i18n flags) of every content type granted to the requested workspace.'
    })
    async list(
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicContentTypeListView> {
        const granted = await this.grants.grantedSlugs(workspaceId);
        return {
            items: this.registry
                .summaries()
                .filter((summary) => granted.has(summary.name))
        };
    }

    /** `GET /api/v1/content-types/:name` — one type's full field schema. */
    @Get(':name')
    @ApiOperation({
        summary: 'Read one content type’s field schema',
        description:
            'Every field of the type with its kind, validation rules, and options — what a client renders or types its models from. 404 when the type is unknown or not granted to the workspace.'
    })
    async get(
        @Param('name') name: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<SerializedContentType> {
        // Resolve through the same grant gate as the entry routes, so an
        // ungranted type reads identically here and there (one 404, no
        // enumeration signal). The registry then serializes the resolved type.
        const { type } = await resolveGrantedType(
            this.registry,
            this.grants,
            name,
            workspaceId
        );
        // Registered by definition (resolveGrantedType returned it), so the
        // serialize can't miss — the non-null assertion documents that.
        return this.registry.serialize(type.name) as SerializedContentType;
    }
}
