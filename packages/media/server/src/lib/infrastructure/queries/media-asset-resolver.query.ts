import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    MediaAssetResolver,
    ResolvedMediaAsset
} from '@orthacms/content-server';
import { mediaAsset } from '../schema/media-asset';

/**
 * Binds content-server's {@link MediaAssetResolver} port to the media schema:
 * a batched, workspace-scoped lookup of the facts content-server needs to
 * enforce a media field (existence + kind/MIME against the field's `accept`).
 * An id that names no asset in the workspace is simply omitted from the map, so
 * a missing and a cross-workspace asset are indistinguishable to the caller.
 *
 * `url` is the app's own raw-stream route — the same one {@link toAssetView}
 * produces — so a revision preview or field control can render the asset.
 */
@Injectable()
export class MediaAssetResolverQuery implements MediaAssetResolver {
    constructor(@InjectDatabase() private readonly db: Database) {}

    async resolve(
        ids: readonly string[],
        workspaceId: string
    ): Promise<Map<string, ResolvedMediaAsset>> {
        const unique = [...new Set(ids)];
        const result = new Map<string, ResolvedMediaAsset>();
        if (!unique.length) return result;

        const rows = await this.db
            .select({
                id: mediaAsset.id,
                kind: mediaAsset.kind,
                mimeType: mediaAsset.mimeType,
                name: mediaAsset.name,
                alt: mediaAsset.alt,
                tracks: mediaAsset.tracks,
                variants: mediaAsset.variants
            })
            .from(mediaAsset)
            .where(
                and(
                    inArray(mediaAsset.id, unique),
                    eq(mediaAsset.workspaceId, workspaceId)
                )
            );

        for (const row of rows) {
            const raw = `/api/media/assets/${row.id}/raw`;
            const variants = (row.variants ?? {}) as Record<string, unknown>;
            const variantUrl = (name: string) =>
                variants[name] ? `${raw}?variant=${name}` : undefined;
            result.set(row.id, {
                id: row.id,
                kind: row.kind,
                mimeType: row.mimeType,
                name: row.name,
                url: raw,
                // Same `?variant=` route the library's own tiles use, so a
                // record's media costs the editor a thumbnail, not an original.
                thumbUrl: variantUrl('thumb'),
                previewUrl: variantUrl('preview'),
                alt: row.alt,
                // The track's `src` is the WebVTT asset's own raw route, not
                // this asset's — the pointer is stored as an id so the file
                // stays an ordinary library asset with its own permissions.
                tracks: (row.tracks ?? []).map((track) => ({
                    kind: track.kind,
                    srclang: track.srclang,
                    label: track.label,
                    src: `/api/media/assets/${track.assetId}/raw`,
                    ...(track.default ? { default: true as const } : {})
                }))
            });
        }
        return result;
    }
}
