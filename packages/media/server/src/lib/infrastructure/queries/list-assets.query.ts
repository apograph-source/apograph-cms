import { Injectable } from '@nestjs/common';
import {
    and,
    asc,
    desc,
    eq,
    ilike,
    isNull,
    or,
    sql,
    type SQL
} from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { mediaAsset, mediaKind } from '../schema/media-asset';
import { InvalidAssetFilterError } from '../../domain/errors/invalid-asset-filter.error';
import type { AssetListView } from '../../types/asset-view';
import { toAssetView } from './to-asset-view';
import { resolveUploaderNames, UNKNOWN_UPLOADER } from './uploader-names';

/** A valid `media_kind` enum value. */
type MediaKindColumn = (typeof mediaKind.enumValues)[number];

/** Matches a canonical (hyphenated, 8-4-4-4-12) uuid. */
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Escapes the `LIKE` metacharacters in a user's search term so `%` and `_` match
 * themselves. Without this, `?search=_` matched every asset with a name of at
 * least one character and `?search=%` matched the whole library — a filter that
 * silently ignores what it was given. The pattern is `ESCAPE '\'` (Postgres's
 * default), so the backslash itself has to be escaped first.
 */
function escapeLikePattern(term: string): string {
    return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Rejects filter values the columns cannot hold, before they reach Postgres.
 * `folder_id` is a `uuid` and `kind` is the `media_kind` enum, so a bad value
 * used to surface as a driver error — a **500** for a plainly bad request.
 */
function assertValidFilters(folderId: unknown, kind: string | undefined): void {
    if (
        typeof folderId === 'string' &&
        folderId.length > 0 &&
        !UUID_PATTERN.test(folderId)
    ) {
        throw new InvalidAssetFilterError(
            'folderId',
            'folderId must be a UUID'
        );
    }
    if (kind && kind !== 'all' && !isMediaKind(kind)) {
        throw new InvalidAssetFilterError(
            'kind',
            `kind must be one of: ${['all', ...mediaKind.enumValues].join(', ')}`
        );
    }
}

/** Narrows a raw string to a `media_kind` enum value. */
function isMediaKind(value: string): value is MediaKindColumn {
    return (mediaKind.enumValues as readonly string[]).includes(value);
}

/** Parameters for a paginated asset listing. */
export interface ListAssetsParams {
    workspaceId: string;
    /**
     * Folder to list, `null` for the workspace root, or **omitted to search
     * every folder** in the workspace.
     *
     * The three-way distinction exists because the two callers want different
     * things and neither can express the other's: the admin's library browses
     * one folder at a time (root is a folder, so `null` has to mean root), while
     * a copilot asked "do we have a logo?" has no idea which folder it is in and
     * would find nothing under either spelling.
     */
    folderId?: string | null;
    search?: string;
    kind?: string;
    sort?: string;
    page: number;
    pageSize: number;
}

/**
 * Read-side listing of a folder's assets — search over the name and tags, an
 * optional kind filter, a whitelisted sort, and `LIMIT/OFFSET` pagination. Returns the
 * admin's `{ items, total, page, pageSize }` envelope. Bypasses the aggregate
 * (a thin CQRS query).
 */
@Injectable()
export class ListAssetsQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Runs the listing. */
    async execute(params: ListAssetsParams): Promise<AssetListView> {
        assertValidFilters(params.folderId, params.kind);
        const conditions: SQL[] = [
            eq(mediaAsset.workspaceId, params.workspaceId)
        ];
        // `undefined` spans every folder; `null` is the root folder. Tested
        // with `in`, not truthiness, so the two stay distinguishable.
        if ('folderId' in params) {
            conditions.push(
                params.folderId
                    ? eq(mediaAsset.folderId, params.folderId)
                    : isNull(mediaAsset.folderId)
            );
        }
        if (params.kind && params.kind !== 'all' && isMediaKind(params.kind)) {
            conditions.push(eq(mediaAsset.kind, params.kind));
        }
        const search = params.search?.trim();
        if (search) {
            // Escaped, so `%` and `_` in the term are literals — every other
            // search in the codebase treats them that way and a user typing an
            // underscore means an underscore.
            const pattern = `%${escapeLikePattern(search)}%`;
            // Name **or** tag. The admin used to search both, in the browser,
            // over whichever page had loaded; moving the search here would have
            // quietly dropped tags from it. `jsonb_array_elements_text` matches
            // one element at a time, so a term cannot span two tags or collide
            // with the JSON punctuation the way a `tags::text` cast would.
            conditions.push(
                or(
                    ilike(mediaAsset.name, pattern),
                    sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${mediaAsset.tags}) AS tag WHERE tag ILIKE ${pattern})`
                ) as SQL
            );
        }
        const where = and(...conditions);
        const offset = (params.page - 1) * params.pageSize;

        const [rows, totals] = await Promise.all([
            this.db
                .select()
                .from(mediaAsset)
                .where(where)
                .orderBy(this.orderFor(params.sort), asc(mediaAsset.id))
                .limit(params.pageSize)
                .offset(offset),
            this.db
                .select({ value: sql<number>`count(*)::int` })
                .from(mediaAsset)
                .where(where)
        ]);

        const uploaderNames = await resolveUploaderNames(
            this.db,
            rows.map((row) => row.uploadedBy)
        );

        return {
            items: rows.map((row) =>
                toAssetView(
                    row,
                    uploaderNames.get(row.uploadedBy) ?? UNKNOWN_UPLOADER
                )
            ),
            total: totals[0]?.value ?? 0,
            page: params.page,
            pageSize: params.pageSize
        };
    }

    private orderFor(sort: string | undefined): SQL {
        switch (sort) {
            case 'name-asc':
                return asc(mediaAsset.name);
            case 'name-desc':
                return desc(mediaAsset.name);
            case 'oldest':
                return asc(mediaAsset.createdAt);
            case 'largest':
                return desc(mediaAsset.size);
            case 'smallest':
                return asc(mediaAsset.size);
            case 'newest':
            default:
                return desc(mediaAsset.createdAt);
        }
    }
}
