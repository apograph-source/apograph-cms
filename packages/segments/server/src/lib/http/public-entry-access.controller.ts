import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Put,
    UseGuards
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
    ApiTokenGuard,
    ApiTokenWorkspaceGuard,
    CurrentApiToken,
    InjectContentRegistry,
    toTokenActor,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry,
    type PublicApiToken
} from '@orthacms/content-server';
import {
    PERMISSIONS,
    Public,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace } from '@orthacms/workspaces-server';
import { EntryAccessService } from '../application/entry-access.service';
import { PublicEntryAccessDto } from './segments.dto';

/** One entry's audiences, as the public API answers them. */
export interface PublicEntryAccess {
    /** The entry asked about. */
    entryId: string;
    /** Whether anybody has decided about it at all. */
    restricted: boolean;
    /** Audience ids that may read it. Empty means **everyone**. */
    allow: string[];
    /** Audience ids that may not, whatever else admits them. */
    deny: string[];
}

/**
 * `GET|PUT /api/v1/content/:typeName/:id/access` — reader entitlements over the
 * **token-authenticated** API.
 *
 * The admin's `PUT /api/segments/entries/:entryId` is session-guarded and stays
 * where it is; this is the same decision reachable by an external client, under
 * the same two permissions its scope already maps to (`segments:read` on both
 * scopes, `segments:manage` on `full`).
 *
 * **It reads from this plugin's table, not through the public entry read.** That
 * read is reader-scoped, so a client that had just restricted an entry would be
 * unable to read back what it had done — the restriction it wrote being the
 * thing hiding it. Asking who may read a record is not reading the record, and
 * the workspace guard is what keeps it from being an enumeration oracle: an id
 * from another workspace answers as an unrestricted entry, exactly as an unknown
 * one does, because access is stored per workspace.
 *
 * **No `OriginGuard`**, for the reason the public write controller documents: a
 * bearer token is never sent ambiently by a browser, so requiring an `Origin`
 * would reject every server-side client instead of protecting anything.
 */
@ApiTags('Segments')
@Public()
@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard)
@ApiSecurity('apiToken')
@ApiHeader({
    name: 'X-Workspace-Id',
    required: false,
    description:
        "The workspace the entry belongs to. Required when the token covers more than one workspace; optional when it covers exactly one. A workspace outside the token's bucket is a 403."
})
@Controller('v1/content')
export class PublicEntryAccessController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly access: EntryAccessService
    ) {}

    /** `GET /api/v1/content/:typeName/:id/access` — who may read one entry. */
    @Get(':typeName/:id/access')
    @RequirePermissions(PERMISSIONS.SEGMENTS_READ)
    @ApiOperation({
        summary: 'Read an entry’s audiences',
        description:
            'An empty `allow` list means **everyone** — not nobody — which is the state every entry is in until somebody restricts it. A deny always wins over an allow. On a localized type this answers for the whole record: every language of it carries the same audiences.'
    })
    async get(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) entryId: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryAccess> {
        await this.assertGranted(typeName, workspaceId);
        const stored = await this.access.get(workspaceId, entryId);
        return {
            entryId,
            restricted: stored.allow.length > 0 || stored.deny.length > 0,
            allow: stored.allow,
            deny: stored.deny
        };
    }

    /** `PUT /api/v1/content/:typeName/:id/access` — replace them. */
    @Put(':typeName/:id/access')
    @RequirePermissions(PERMISSIONS.SEGMENTS_MANAGE)
    @ApiOperation({
        summary: 'Set an entry’s audiences',
        description:
            'Replaces **both** lists, so send the whole intended state rather than a change to it — there is no spelling for "leave the rest alone". Two empty lists open the entry to everyone and remove its row. On a localized type this writes every language of the record: who may read something is a fact about the record, not about one translation of it. The change is live when this answers.'
    })
    async set(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) entryId: string,
        @Body() body: PublicEntryAccessDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentApiToken() token: PublicApiToken
    ): Promise<PublicEntryAccess> {
        const type = await this.assertGranted(typeName, workspaceId);
        const written = await this.access.setForGroup({
            workspaceId,
            type,
            entryId,
            allow: body.allow,
            deny: body.deny,
            // The token is the actor, exactly as it is on a content write —
            // `activity_events.actor_type` is what lets a credential be named
            // instead of the row reading "System".
            actor: toTokenActor(token)
        });
        return {
            entryId,
            restricted:
                written.access.allow.length > 0 ||
                written.access.deny.length > 0,
            allow: written.access.allow,
            deny: written.access.deny
        };
    }

    /**
     * The content type, if this workspace was granted it.
     *
     * A type the workspace does not hold reads the same as an unknown one, so a
     * client cannot learn the installation's type list by probing — the same
     * rule the public content routes follow.
     */
    private async assertGranted(typeName: string, workspaceId: string) {
        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new BadRequestException(
                `Unknown content type "${typeName}".`
            );
        }
        return type;
    }
}
