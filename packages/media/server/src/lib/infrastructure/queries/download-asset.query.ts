import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { STORAGE_PROVIDER, type StorageProvider } from '@orthacms/media-domain';
import { mediaAsset } from '../schema/media-asset';

/** Where an asset's bytes live, plus the workspace that owns it. */
export interface AssetLocation {
    /** The owning workspace — the authorization subject for the download. */
    workspaceId: string;
    storageProvider: string;
    storageKey: string;
    mimeType: string;
    name: string;
    size: number;
}

/**
 * Resolves an asset's bytes for the download route, in two steps so the caller
 * can authorize **between** them: {@link locate} is a metadata-only lookup that
 * reports the owning workspace, and {@link open} streams from the provider that
 * actually holds the blob. Splitting them keeps storage untouched until the
 * caller has confirmed the requester may read it.
 */
@Injectable()
export class DownloadAssetQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider
    ) {}

    /**
     * Looks an asset up by id alone — **unscoped**, because the download route
     * derives the workspace from the row instead of taking it from the caller
     * (an `<img>` tag can't send the `X-Workspace-Id` header). Returns `null`
     * when there is no such asset; the caller must still authorize the returned
     * `workspaceId` before opening the stream.
     *
     * When `variant` names a generated derivative the asset actually has, the
     * returned location points at that derivative (WebP) instead of the
     * original; an unknown/absent variant transparently falls back to the
     * original, so a stale link never 404s.
     */
    async locate(id: string, variant?: string): Promise<AssetLocation | null> {
        const [row] = await this.db
            .select({
                workspaceId: mediaAsset.workspaceId,
                storageProvider: mediaAsset.storageProvider,
                storageKey: mediaAsset.storageKey,
                mimeType: mediaAsset.mimeType,
                name: mediaAsset.name,
                size: mediaAsset.size,
                variants: mediaAsset.variants
            })
            .from(mediaAsset)
            .where(eq(mediaAsset.id, id))
            .limit(1);
        if (!row) return null;

        const { variants, ...base } = row;
        // `hasOwn`, not a bare index: `variants` is a plain JSON object, so
        // `?variant=toString` would otherwise resolve a prototype member,
        // enter this branch with no `key`, and blow up in the provider.
        const chosen =
            variant && variants && Object.hasOwn(variants, variant)
                ? variants[variant]
                : undefined;
        if (chosen) {
            return {
                ...base,
                storageKey: chosen.key,
                mimeType: 'image/webp',
                size: chosen.size
            };
        }
        return base;
    }

    /**
     * Opens the byte stream for an already-authorized asset.
     *
     * The row's `storageProvider` is **checked**, not used to look a backend
     * up: a deployment runs exactly one, and a row naming another one is bytes
     * this process cannot reach. `StorageProviderCheck` refuses to boot in that
     * state, so this is the belt to that braces — but it fails loudly with the
     * two names rather than handing a foreign key to a provider that would
     * answer with whatever it happens to find there.
     */
    async open(location: AssetLocation): Promise<Readable> {
        if (location.storageProvider !== this.provider.id) {
            throw new Error(
                `Asset is stored by provider "${location.storageProvider}", but this deployment runs ` +
                    `"${this.provider.id}". Its bytes are in the other backend.`
            );
        }
        return this.provider.get(location.storageKey);
    }
}
