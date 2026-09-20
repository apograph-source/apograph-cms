import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain event kinds the media aggregates raise — one per state change, as
 * dotted names. They are the post-commit audit + blob-GC seam: a subscriber
 * (later) turns `media.asset.deleted` into the actual blob removal and the
 * audit row.
 */
export const MEDIA_EVENT_KINDS = {
    ASSET_UPLOADED: 'media.asset.uploaded',
    ASSET_UPDATED: 'media.asset.updated',
    ASSET_MOVED: 'media.asset.moved',
    ASSET_DELETED: 'media.asset.deleted',
    FOLDER_CREATED: 'media.folder.created',
    FOLDER_RENAMED: 'media.folder.renamed',
    FOLDER_DELETED: 'media.folder.deleted'
} as const;

/** Builds an asset {@link DomainEvent}, stamping the aggregate type + id. */
export function assetEvent(
    kind: string,
    assetId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'media.asset',
        aggregateId: assetId,
        payload
    });
}

/** Builds a folder {@link DomainEvent}, stamping the aggregate type + id. */
export function folderEvent(
    kind: string,
    folderId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'media.folder',
        aggregateId: folderId,
        payload
    });
}
