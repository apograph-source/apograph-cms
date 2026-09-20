import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    AttachmentRef,
    AttachmentResolver
} from '@orthacms/copilot-domain';
import { mediaAsset } from '../infrastructure/schema/media-asset';
import { isReadableMimeType } from './asset-text';

/**
 * Binds the copilot's `COPILOT_ATTACHMENT_RESOLVER` port — how a run learns
 * what the files someone attached to a message actually are.
 *
 * The same open-host inversion as the tool and applier ports: `copilot/server`
 * declares the port and never imports media, and media binds it. That is what
 * lets this reach straight into `media_asset` instead of the copilot having to
 * be taught what an asset is.
 *
 * **Workspace-scoped, and it omits rather than reports.** An id in a request
 * body is proven by nothing, so the filter is on the query and an asset
 * belonging to another workspace comes back absent — indistinguishable from one
 * that was deleted. The engine turns a short result into one error naming the
 * count, which is all a user can act on anyway; saying *which* id exists
 * elsewhere would make this an asset-id oracle in the one place a caller
 * chooses the ids.
 */
@Injectable()
export class AttachmentResolverQuery implements AttachmentResolver {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Resolves the ids that exist in `workspaceId`, dropping the rest. */
    async resolve(
        assetIds: readonly string[],
        workspaceId: string
    ): Promise<readonly AttachmentRef[]> {
        if (assetIds.length === 0) {
            return [];
        }

        const rows = await this.db
            .select({
                id: mediaAsset.id,
                name: mediaAsset.name,
                kind: mediaAsset.kind,
                mimeType: mediaAsset.mimeType,
                size: mediaAsset.size
            })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.workspaceId, workspaceId),
                    inArray(mediaAsset.id, [...assetIds])
                )
            );

        return rows.map((row) => ({
            assetId: row.id,
            name: row.name,
            kind: row.kind,
            mimeType: row.mimeType,
            size: row.size,
            // Answered here rather than left for the model to discover by
            // calling the read tool and failing: `isReadableMimeType` is the
            // same allowlist `media_asset_read` enforces, so the two can't
            // disagree about what a run is able to open.
            readable: isReadableMimeType(row.mimeType)
        }));
    }
}
