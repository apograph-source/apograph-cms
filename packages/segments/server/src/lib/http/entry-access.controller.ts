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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EventActor } from '@orthacms/database';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import {
    InjectContentRegistry,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import {
    EntryAccessService,
    type EntryAccessView
} from '../application/entry-access.service';
import { SetEntryAccessDto } from './segments.dto';

/**
 * One entry's access — read it, replace it.
 *
 * A `PUT`, not a `PATCH`, and that is the API telling the truth about what
 * happens: the editor submits the whole state of both lists and it becomes the
 * whole state. There is nothing to merge into, because there is nothing else
 * governing the entry — no rule to inherit from, no level above. What is sent
 * is what a reader is matched against on the next request.
 *
 * Workspace-scoped, so an entry id from another workspace cannot be written
 * through a session that holds this one.
 */
@ApiTags('Segments')
@Controller('segments/entries')
@UseGuards(PermissionsGuard, WorkspaceGuard)
export class EntryAccessController {
    constructor(
        private readonly access: EntryAccessService,
        // The token, not the class: content provides the registry as a
        // `useValue` under `CONTENT_REGISTRY`, so a class-typed parameter would
        // resolve to nothing.
        @InjectContentRegistry()
        private readonly types: ContentTypeRegistry
    ) {}

    /** One entry's lists. An entry nobody restricted reads as two empty ones. */
    @Get(':entryId')
    @RequirePermissions(PERMISSIONS.SEGMENTS_READ)
    @ApiOperation({
        summary: 'Read an entry’s access',
        description:
            'Two empty lists mean the entry is readable by everyone — the state every entry is in until somebody decides otherwise.'
    })
    get(
        @CurrentWorkspace() workspaceId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string
    ): Promise<EntryAccessView> {
        return this.access.get(workspaceId, entryId);
    }

    /** Replace one entry's lists — and, on a localized type, its siblings'. */
    @Put(':entryId')
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.SEGMENTS_MANAGE)
    @ApiOperation({
        summary: 'Set an entry’s access',
        description:
            'Replaces both lists, on every locale of the record. Sending two empty ones opens it to everyone and removes its rows. The change is live when this answers — there is nothing to re-derive.'
    })
    set(
        @CurrentWorkspace() workspaceId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @Body() body: SetEntryAccessDto,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryAccessView> {
        // Resolved from the registry rather than taken as a slug, because the
        // fan-out over the locale group needs the type's **table** — and because
        // an unknown slug is then a 400 here instead of a row written under a
        // type nothing serves.
        const type = this.types.get(body.typeSlug);
        if (!type) {
            throw new BadRequestException(
                `Unknown content type "${body.typeSlug}".`
            );
        }
        return (
            this.access
                .setForGroup({
                    workspaceId,
                    type,
                    entryId,
                    allow: body.allow,
                    deny: body.deny,
                    actor: toActor(user)
                })
                // The ids it also wrote matter only on the entry-save path, where
                // content turns them into revisions. This route appends none — it is
                // not inside a save — so the caller gets the entry's lists, which is
                // what it asked for.
                .then((written) => written.access)
        );
    }
}

/**
 * The signed-in administrator as the {@link EventActor} a segments write stamps
 * onto its domain event, or `undefined` when there is nobody to name.
 */
function toActor(user?: PublicUser): EventActor | undefined {
    return user ? { id: user.id, email: user.email ?? null } : undefined;
}
