import type { DomainEvent } from '@orthacms/database';
import type { StoredMediaTrack } from './value-objects/media-track';
import { AssetId } from './value-objects/asset-id';
import { FolderId } from './value-objects/folder-id';
import { FileName } from './value-objects/file-name';
import { MediaKind, type MediaKindValue } from './value-objects/media-kind';
import { StorageKey } from './value-objects/storage-key';
import { assetEvent, MEDIA_EVENT_KINDS } from './events/media-events';

/** Optional visual / temporal metadata carried by some assets. */
export interface AssetMedia {
    width: number | null;
    height: number | null;
    duration: number | null;
}

/**
 * A generated display derivative of an image — its storage key (held by the
 * same provider as the original) plus intrinsic size. Keyed by variant name
 * (`thumb`, `preview`) in {@link Asset.variants}.
 */
export interface AssetVariant {
    key: string;
    width: number;
    height: number;
    size: number;
}

/** The generated derivatives of an asset, by variant name. */
export type AssetVariants = Record<string, AssetVariant>;

/** Everything needed to build a brand-new asset (post-upload). */
export interface NewAssetProps {
    id: AssetId;
    workspaceId: string;
    /** Destination folder, or `null` for the workspace root. */
    folderId: FolderId | null;
    name: FileName;
    storageKey: StorageKey;
    storageProvider: string;
    kind: MediaKind;
    mimeType: string;
    size: number;
    checksum: string | null;
    uploadedBy: string;
    media?: Partial<AssetMedia>;
    /** Generated derivatives keyed by variant name (`thumb`/`preview`). */
    variants?: AssetVariants;
    /**
     * Alternative text supplied at upload. Normalized like `setAlt` — a blank
     * or whitespace-only value is stored as `null`, so it never counts as
     * covered in the alt-coverage aggregate.
     */
    alt?: string | null;
}

/** The persisted shape used to rehydrate a loaded asset. */
export interface AssetState {
    id: string;
    workspaceId: string;
    folderId: string | null;
    name: string;
    storageKey: string;
    storageProvider: string;
    kind: MediaKindValue;
    mimeType: string;
    size: number;
    checksum: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
    variants: AssetVariants;
    tags: string[];
    alt: string | null;
    tracks: StoredMediaTrack[];
    uploadedBy: string;
}

/**
 * The media asset aggregate root. Owns the mutable metadata a user edits
 * (name, folder, tags, alt) and the immutable facts of the stored blob
 * (storage key + provider, kind, mime, size, checksum). Every mutator is
 * idempotent and raises a `media.asset.*` domain event; `pullEvents()` drains
 * them for the outbox. The stored bytes live behind the `StorageProvider`; the
 * aggregate only knows the key + which provider holds it.
 */
export class Asset {
    private readonly events: DomainEvent[] = [];

    private constructor(
        private readonly _id: AssetId,
        private readonly _workspaceId: string,
        private _folderId: FolderId | null,
        private _name: FileName,
        private readonly _storageKey: StorageKey,
        private readonly _storageProvider: string,
        private readonly _kind: MediaKind,
        private readonly _mimeType: string,
        private readonly _size: number,
        private readonly _checksum: string | null,
        private readonly _media: AssetMedia,
        private readonly _variants: AssetVariants,
        private _tags: string[],
        private _alt: string | null,
        private _tracks: StoredMediaTrack[],
        private readonly _uploadedBy: string,
        private readonly _isNew: boolean
    ) {}

    /** Freshly uploaded — raises `media.asset.uploaded`. */
    static create(props: NewAssetProps): Asset {
        const asset = new Asset(
            props.id,
            props.workspaceId,
            props.folderId,
            props.name,
            props.storageKey,
            props.storageProvider,
            props.kind,
            props.mimeType,
            props.size,
            props.checksum,
            {
                width: props.media?.width ?? null,
                height: props.media?.height ?? null,
                duration: props.media?.duration ?? null
            },
            props.variants ?? {},
            [],
            normalizeAlt(props.alt),
            // A fresh upload has none: captioning is a later act.
            [],
            props.uploadedBy,
            true
        );
        asset.raise(MEDIA_EVENT_KINDS.ASSET_UPLOADED, {
            name: props.name.value,
            kind: props.kind.value,
            folderId: props.folderId?.value ?? null
        });
        return asset;
    }

    /** Rebuilds a loaded asset from its persisted state — raises no events. */
    static rehydrate(state: AssetState): Asset {
        return new Asset(
            AssetId.create(state.id),
            state.workspaceId,
            state.folderId ? FolderId.create(state.folderId) : null,
            FileName.create(state.name),
            StorageKey.create(state.storageKey),
            state.storageProvider,
            MediaKind.of(state.kind),
            state.mimeType,
            state.size,
            state.checksum,
            {
                width: state.width,
                height: state.height,
                duration: state.duration
            },
            state.variants,
            [...state.tags],
            state.alt,
            [...(state.tracks ?? [])],
            state.uploadedBy,
            false
        );
    }

    /** The asset id. */
    get id(): AssetId {
        return this._id;
    }
    /** The owning workspace id. */
    get workspaceId(): string {
        return this._workspaceId;
    }
    /** The current folder, or `null` at the workspace root. */
    get folderId(): FolderId | null {
        return this._folderId;
    }
    /** The current file name. */
    get name(): FileName {
        return this._name;
    }
    /** The provider storage key. */
    get storageKey(): StorageKey {
        return this._storageKey;
    }
    /** The name of the provider holding the bytes. */
    get storageProvider(): string {
        return this._storageProvider;
    }
    /** The coarse media kind. */
    get kind(): MediaKind {
        return this._kind;
    }
    /** The MIME type. */
    get mimeType(): string {
        return this._mimeType;
    }
    /** Size in bytes. */
    get size(): number {
        return this._size;
    }
    /** sha256 checksum, if computed. */
    get checksum(): string | null {
        return this._checksum;
    }
    /** Optional visual / temporal metadata. */
    get media(): AssetMedia {
        return this._media;
    }
    /** The generated derivatives, keyed by variant name. */
    get variants(): AssetVariants {
        return this._variants;
    }
    /** Every storage key this asset owns — the original plus its derivatives. */
    get storageKeys(): string[] {
        return [
            this._storageKey.value,
            ...Object.values(this._variants).map((v) => v.key)
        ];
    }
    /** A copy of the current tags. */
    get tags(): string[] {
        return [...this._tags];
    }
    /** Alt text, or `null`. */
    get tracks(): StoredMediaTrack[] {
        return [...this._tracks];
    }

    get alt(): string | null {
        return this._alt;
    }
    /** The uploader's user id. */
    get uploadedBy(): string {
        return this._uploadedBy;
    }
    /** Whether this aggregate has never been persisted. */
    get isNew(): boolean {
        return this._isNew;
    }

    /** Renames the asset (idempotent). */
    rename(raw: string): void {
        const next = FileName.create(raw);
        if (next.equals(this._name)) return;
        this._name = next;
        this.raise(MEDIA_EVENT_KINDS.ASSET_UPDATED, { name: next.value });
    }

    /** Moves the asset to another folder, or the root when `null` (idempotent). */
    moveTo(folderId: FolderId | null): void {
        const same =
            (folderId === null && this._folderId === null) ||
            (folderId !== null &&
                this._folderId !== null &&
                folderId.equals(this._folderId));
        if (same) return;
        this._folderId = folderId;
        this.raise(MEDIA_EVENT_KINDS.ASSET_MOVED, {
            folderId: folderId?.value ?? null
        });
    }

    /** Replaces the tag set, normalized (trimmed, de-duplicated, non-empty). */
    retag(tags: string[]): void {
        const normalized = Array.from(
            new Set(tags.map((tag) => tag.trim()).filter(Boolean))
        );
        this._tags = normalized;
        this.raise(MEDIA_EVENT_KINDS.ASSET_UPDATED, { tags: normalized });
    }

    /**
     * Replaces the asset's timed-text tracks.
     *
     * Whole-set replacement rather than add/remove, matching {@link retag}: the
     * editor shows the list and saves the list, and a partial mutator would need
     * an identity for a track that has no natural key beyond `(kind, srclang)`.
     *
     * A track's `srclang` is required by the storage type and trimmed here: a
     * `<track>` with a blank `srclang` cannot be selected by a player and is
     * announced with the page's phonemes, which is worse than no track at all
     * (`ORT-92`).
     */
    setTracks(tracks: StoredMediaTrack[]): void {
        const normalized = tracks
            .map((track) => ({
                kind: track.kind,
                srclang: track.srclang.trim(),
                label: track.label.trim(),
                assetId: track.assetId,
                ...(track.default ? { default: true as const } : {})
            }))
            .filter((track) => track.srclang && track.assetId);
        this._tracks = normalized;
        this.raise(MEDIA_EVENT_KINDS.ASSET_UPDATED, { tracks: normalized });
    }

    /** Sets or clears alt text (idempotent). */
    setAlt(alt: string | null): void {
        const next = normalizeAlt(alt);
        if (next === this._alt) return;
        this._alt = next;
        this.raise(MEDIA_EVENT_KINDS.ASSET_UPDATED, { alt: next });
    }

    /**
     * Marks the asset deleted — raises `media.asset.deleted` carrying the key +
     * provider so a post-commit subscriber can reclaim the blob.
     */
    markDeleted(): void {
        this.raise(MEDIA_EVENT_KINDS.ASSET_DELETED, {
            storageKey: this._storageKey.value,
            storageProvider: this._storageProvider
        });
    }

    /** Drains and returns the accumulated domain events. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }

    private raise(kind: string, payload: Record<string, unknown>): void {
        // Every asset event carries its workspace, which is what fills the
        // audit row's `workspace_id` — the log's only way to answer a
        // workspace-shaped question, since it holds no FK to anything.
        this.events.push(
            assetEvent(kind, this._id.value, {
                ...payload,
                workspaceId: this._workspaceId
            })
        );
    }
}

/**
 * Trims alt text and collapses "blank" to `null`. A whitespace-only string is
 * not a description, and the insights aggregate refuses to count one as
 * covered — so the two places alt can be set (upload and update) normalize it
 * identically rather than letting the column hold `'   '`.
 */
function normalizeAlt(alt: string | null | undefined): string | null {
    return alt && alt.trim().length > 0 ? alt.trim() : null;
}
