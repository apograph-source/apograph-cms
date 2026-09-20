import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Query,
    UseGuards
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import {
    PERMISSIONS,
    Public,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import { WorkspaceGrantsQuery } from '../../../content-types/queries/workspace-grants.query';
import {
    PublicEntriesQuery,
    type EntryLocator
} from '../../infrastructure/public-entries.query';
import type {
    PublicEntry,
    PublicEntryListView
} from '../../types/public-entry';
import type {
    PublicMediaFieldView,
    PublicRelationFieldView
} from '../../types/public-expansion';
import { RELATION_PAGE_SIZE } from '../../../entries/infrastructure/persistence/relation-link.service';
import { ApiTokenGuard } from '../guards/api-token.guard';
import { ApiTokenWorkspaceGuard } from '../guards/api-token-workspace.guard';
import { DraftVisibilityGuard } from '../guards/draft-visibility.guard';
import {
    PublicEntryQueryDto,
    PublicListEntriesQueryDto
} from '../dto/public-list-entries-query.dto';
import { resolveGrantedType } from './resolve-granted-type';

/** One entry's media assets, keyed by field name. */
export interface PublicEntryMediaView {
    media: Record<string, PublicMediaFieldView>;
}

/** One entry's sibling translations. */
export interface PublicEntryTranslationsView {
    translations: PublicEntry[];
}

/**
 * `GET /api/v1/content/...` — the **public, token-authenticated read API** an
 * external site or app fetches content with. One route pair serves every
 * code-defined type: `:typeName` is resolved against the registry (and the
 * workspace's grants) at request time.
 *
 * `@Public()` opts these routes out of the session `AuthGuard`; `ApiTokenGuard`
 * then authenticates the `Authorization: Bearer` token and checks
 * `content:read` against its scope, and `ApiTokenWorkspaceGuard` resolves which
 * of the token's workspaces the request targets (the `X-Workspace-Id` header,
 * or the only one when the token covers a single workspace).
 *
 * Reads are flat and live-only — published entries, no drafts, no soft-deleted
 * rows, and `values` carries the entry's own data only (no relation or media
 * fields, in either direction). See {@link PublicEntriesQuery} for the exact
 * visibility rule and `types/public-entry.ts` for the wire shape.
 *
 * A `single` (page) type is served by the same list route as a collection: with
 * localization a single still has one row per locale, so a list envelope is the
 * honest shape for both — take `items[0]`.
 */
@Public()
@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard, DraftVisibilityGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@ApiSecurity('apiToken')
@ApiHeader({
    name: 'X-Workspace-Id',
    required: false,
    description:
        "The workspace to read from. Required when the token covers more than one workspace; optional (and ignored) when it covers exactly one. A workspace outside the token's bucket is a 403."
})
@Controller('v1/content')
export class PublicEntriesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly entries: PublicEntriesQuery
    ) {}

    /** `GET /api/v1/content/:typeName` — one page of published entries. */
    @Get(':typeName')
    @ApiOperation({
        summary: 'List published entries of a content type',
        description:
            'One page of the type’s published, non-deleted entries in the requested workspace, newest-updated first by default. Supports free-text `?search=` and the structured `?filter=` tree (the same shape the admin query builder emits). 404 when the type is unknown or the workspace was not granted it.'
    })
    async list(
        @Param('typeName') typeName: string,
        @Query() query: PublicListEntriesQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryListView> {
        const { type, granted } = await resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            workspaceId
        );
        return this.entries.list(type, query, workspaceId, granted);
    }

    // ---- addressed by translation group -----------------------------------
    //
    // Every single-entry read below exists twice: once under `:id` and once
    // under `group/:localeGroupId`. Anything a consumer can do holding an
    // entry id, it can do holding the group id plus a `?locale=` — which is
    // the identity a localized front-end actually carries, since the group is
    // stable across languages and each locale's `id` is not. Both forms funnel
    // into the same `EntryLocator`, so the two spellings cannot drift on what
    // they return or what they hide.
    //
    // The `group/...` routes are declared FIRST. They cannot be shadowed by
    // the `:id` ones on segment count alone (`:typeName/:id/relations/:field`
    // requires a literal `relations` where a group route carries the group id),
    // but Express matches in declaration order, so putting the more specific
    // literal-prefixed routes ahead of the wildcards keeps that independent of
    // how the pattern set grows.

    /**
     * `GET /api/v1/content/:typeName/group/:localeGroupId` — one published
     * entry addressed by its translation group and the requested locale.
     */
    @Get(':typeName/group/:localeGroupId')
    @ApiOperation({
        summary: 'Read one published entry by translation group + locale',
        description:
            'The group’s published row in the requested `?locale=` (the default locale when none is given) — so a localized front-end renders “this story” by varying the locale alone, instead of keeping a per-locale id map. Takes the same expansion params as the `:id` read. 404 when the group has no published row in that locale, or does not exist. 400 when the type is not localized.'
    })
    async getByLocaleGroup(
        @Param('typeName') typeName: string,
        @Param('localeGroupId', ParseUUIDPipe) localeGroupId: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntry> {
        return this.readEntry(typeName, { localeGroupId }, query, workspaceId);
    }

    /**
     * `GET /api/v1/content/:typeName/group/:localeGroupId/relations/:field` —
     * one page of a relation field's links, for the group's row in the
     * requested locale.
     */
    @Get(':typeName/group/:localeGroupId/relations/:field')
    @ApiOperation({
        summary: 'Page one relation field’s links, by translation group',
        description:
            'As the `:id` form, for the group’s published row in the requested `?locale=`.'
    })
    async getRelationFieldByLocaleGroup(
        @Param('typeName') typeName: string,
        @Param('localeGroupId', ParseUUIDPipe) localeGroupId: string,
        @Param('field') field: string,
        @Query() query: PublicListEntriesQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicRelationFieldView> {
        return this.readRelationField(
            typeName,
            { localeGroupId },
            field,
            query,
            workspaceId
        );
    }

    /**
     * `GET /api/v1/content/:typeName/group/:localeGroupId/media` — the media
     * assets of the group's row in the requested locale.
     */
    @Get(':typeName/group/:localeGroupId/media')
    @ApiOperation({
        summary: 'Read one entry’s media assets, by translation group',
        description:
            'As the `:id` form, for the group’s published row in the requested `?locale=`.'
    })
    async getMediaByLocaleGroup(
        @Param('typeName') typeName: string,
        @Param('localeGroupId', ParseUUIDPipe) localeGroupId: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryMediaView> {
        return this.readMedia(typeName, { localeGroupId }, query, workspaceId);
    }

    /**
     * `GET /api/v1/content/:typeName/group/:localeGroupId/translations` — the
     * group's other published locale rows.
     *
     * Reachable without holding any entry id at all: the group id alone names
     * every language a story is live in.
     */
    @Get(':typeName/group/:localeGroupId/translations')
    @ApiOperation({
        summary: 'Read a translation group’s other locale rows',
        description:
            'As the `:id` form, for the group’s published row in the requested `?locale=` — so the group id alone is enough to enumerate the languages a story is live in.'
    })
    async getTranslationsByLocaleGroup(
        @Param('typeName') typeName: string,
        @Param('localeGroupId', ParseUUIDPipe) localeGroupId: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryTranslationsView> {
        return this.readTranslations(
            typeName,
            { localeGroupId },
            query,
            workspaceId
        );
    }

    // ---- addressed by entry id ---------------------------------------------

    /** `GET /api/v1/content/:typeName/:id` — one published entry. */
    @Get(':typeName/:id')
    @ApiOperation({
        summary: 'Read one published entry',
        description:
            'A single published, non-deleted entry of the type. A draft, a soft-deleted entry, one in another workspace, and an unknown id are all the same 404.'
    })
    async getOne(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntry> {
        return this.readEntry(typeName, { id }, query, workspaceId);
    }

    /**
     * `GET /api/v1/content/:typeName/:id/relations/:field` — one page of a
     * single relation field's links.
     *
     * The **only** relation route, deliberately. An all-fields sibling
     * (`/:id/relations`) used to sit here and returned exactly what
     * `GET /:id?relations=preview` already returns minus the entry — a second
     * spelling of one read, on a contract that has to stay still. Paging one
     * field past the preview's cap is the one thing a query parameter cannot
     * express, so it is the one thing that keeps a route.
     */
    @Get(':typeName/:id/relations/:field')
    @ApiOperation({
        summary: 'Page one relation field’s links',
        description:
            'One ordered page of a single relation field’s visible links — the way past the `?relationLimit=` cap that `?relations=preview` applies. Only published targets are shown or counted. 400 when the field is not a relation, or its target type is not granted to the workspace.'
    })
    async getRelationField(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('field') field: string,
        @Query() query: PublicListEntriesQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicRelationFieldView> {
        return this.readRelationField(
            typeName,
            { id },
            field,
            query,
            workspaceId
        );
    }

    /**
     * `GET /api/v1/content/:typeName/:id/media` — every media field of one
     * entry, resolved to asset metadata and URLs.
     */
    @Get(':typeName/:id/media')
    @ApiOperation({
        summary: 'Read one entry’s media assets',
        description:
            'Every media field of the entry, keyed by field name, resolved to asset metadata (name, kind, MIME type, alt) and URLs. The URLs are the CMS media routes, which require an authenticated session — a bearer token cannot fetch them.'
    })
    async getMedia(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryMediaView> {
        return this.readMedia(typeName, { id }, query, workspaceId);
    }

    /**
     * `GET /api/v1/content/:typeName/:id/translations` — the entry's other
     * locale rows. The sibling of `?translations=preview`, for a consumer that
     * already holds the entry.
     */
    @Get(':typeName/:id/translations')
    @ApiOperation({
        summary: 'Read one entry’s sibling translations',
        description:
            'The entry’s other published locale rows — the rest of its translation group — ordered by locale slug, each a full entry honouring the same `?fields=` selection. The entry itself is not repeated. 400 when the type is not localized.'
    })
    async getTranslations(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: PublicEntryQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<PublicEntryTranslationsView> {
        return this.readTranslations(typeName, { id }, query, workspaceId);
    }

    // ---- the shared handlers, one per read ---------------------------------
    //
    // Each is called by exactly two routes — the `:id` spelling and the
    // `group/:localeGroupId` one — so the pair is a routing detail and never a
    // behavioural fork.

    /** @see getOne */
    private async readEntry(
        typeName: string,
        locator: EntryLocator,
        query: PublicEntryQueryDto,
        workspaceId: string
    ): Promise<PublicEntry> {
        const { type, granted } = await resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            workspaceId
        );
        return this.entries.getOne(type, locator, workspaceId, query, granted);
    }

    /** @see getRelationField */
    private async readRelationField(
        typeName: string,
        locator: EntryLocator,
        field: string,
        query: PublicListEntriesQueryDto,
        workspaceId: string
    ): Promise<PublicRelationFieldView> {
        const { type, granted } = await resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            workspaceId
        );
        return this.entries.relationField(
            type,
            locator,
            field,
            query.page ?? 1,
            query.pageSize ?? query.relationLimit ?? RELATION_PAGE_SIZE,
            workspaceId,
            granted,
            query.locale,
            query.status
        );
    }

    /** @see getMedia */
    private async readMedia(
        typeName: string,
        locator: EntryLocator,
        query: PublicEntryQueryDto,
        workspaceId: string
    ): Promise<PublicEntryMediaView> {
        const { type } = await resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            workspaceId
        );
        return {
            media: await this.entries.mediaOf(
                type,
                locator,
                workspaceId,
                query.locale,
                query.mediaLimit,
                query.status
            )
        };
    }

    /** @see getTranslations */
    private async readTranslations(
        typeName: string,
        locator: EntryLocator,
        query: PublicEntryQueryDto,
        workspaceId: string
    ): Promise<PublicEntryTranslationsView> {
        const { type } = await resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            workspaceId
        );
        return {
            translations: await this.entries.translationsOf(
                type,
                locator,
                workspaceId,
                query
            )
        };
    }
}
