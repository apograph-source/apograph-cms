/**
 * The **transfer document** — what an export produces and an import consumes,
 * in every format. Formats differ in how this is written down (one JSON object,
 * a line per record, a flat table, a ZIP member); they do not differ in what it
 * means.
 *
 * The shape is deliberately installation-agnostic. A row id from the source
 * database is carried, but only as a handle *within one document* — the thing
 * that survives the trip to another installation is the **natural key**
 * ({@link TransferRecord.$key}), which is why every record and every reference
 * carries one.
 */

import type { EntryStatus } from '@apograph/content-domain';

/**
 * Wire version of the document. Bumped when a change would make an older
 * importer read a newer document **wrongly** — a new optional field is not a
 * bump, a changed meaning is. The importer refuses a version it does not know
 * rather than guessing.
 */
export const TRANSFER_FORMAT_VERSION = 1;

/**
 * A pointer from one record to another.
 *
 * It carries both handles because they answer different questions.
 * {@link $id} resolves inside *this* document — the case where the target was
 * exported alongside the source and both are being created right now, so no
 * natural key could match anything yet. {@link $key} resolves against a target
 * installation that has never seen this document before. An importer tries them
 * in that order.
 */
export interface TransferRef {
    /** The referenced content type. */
    $type: string;
    /**
     * The target's source row id. Present when the target is in this document;
     * absent for a record the export stopped short of (a depth-2 neighbour).
     */
    $id?: string;
    /**
     * The target's natural key. Empty when the type resolved no identity
     * fields — such a reference can only be resolved via {@link $id}, and
     * becomes an unresolved report line when that fails.
     */
    $key: Record<string, string>;
    /**
     * The target row's locale, when the target type is localized.
     *
     * Part of the match, not decoration: a localized type's key values are
     * per-row (`en`/`hello` and `de`/`hallo` are different rows of one record),
     * so a key without the locale would be ambiguous exactly where a
     * translation shares a slug with its source.
     */
    $locale?: string;
}

/** One timed-text track travelling with a video or audio asset. */
export interface TransferAssetTrack {
    kind: string;
    srclang: string;
    label: string;
    /** Path of the track's bytes inside a ZIP archive, when carried. */
    path?: string;
    /** The source installation's URL, for the formats that carry no bytes. */
    url?: string;
    default?: boolean;
}

/**
 * A media asset referenced by a record, described well enough to be recreated
 * somewhere else.
 *
 * {@link checksum} leads the matching on import: re-uploading bytes the target
 * already holds is the difference between an import that costs a few rows and
 * one that duplicates a media library.
 */
export interface TransferAssetRef {
    /** The record field this asset is referenced from. */
    field: string;
    /** Source asset id — resolves within this document only. */
    $id: string;
    /** Path of the bytes inside a ZIP archive. Absent in the file-less formats. */
    path?: string;
    /** The source installation's stream URL, for the file-less formats. */
    url?: string;
    name: string;
    mimeType: string;
    size: number;
    /** `sha256:<hex>`, when the source recorded one. The dedup key on import. */
    checksum?: string;
    alt?: string | null;
    /** Timed text, for a video or audio asset. */
    tracks?: TransferAssetTrack[];
}

/**
 * How far from the selected records the export reached. `0` is a record the
 * user picked (or a locale sibling of one); `1` is a record pulled in only
 * because something at depth 0 pointed at it.
 *
 * The importer reads it: a depth-1 record is context, so a validation failure
 * on one degrades to a skipped link rather than failing the record that
 * actually was asked for.
 */
export type TransferDepthLevel = 0 | 1;

/** One exported record — the row, its links, and its files. */
export interface TransferRecord {
    /** Content type name. */
    $type: string;
    /** Source row id. A handle within this document; never written to a target. */
    $id: string;
    /** Natural key values, keyed by field name. Empty when none could be derived. */
    $key: Record<string, string>;
    /** Where the walker found it. */
    $depth: TransferDepthLevel;
    /** Locale slug, for a row of a localized type. */
    $locale?: string;
    /**
     * Source translation-group id, for a row of a localized type. Siblings in
     * one document share it, which is how the importer rebuilds the group
     * without inventing a per-locale matching rule.
     */
    $localeGroup?: string;
    /** Draft/published, for a publishable type. */
    $status?: EntryStatus;
    /** Scalar field values, keyed by field name. */
    values: Record<string, unknown>;
    /**
     * Relation fields, keyed by field name: one ref for a single relation, a
     * list for a many relation (in the owner's order), `null` for an explicitly
     * empty single relation.
     */
    relations: Record<string, TransferRef | TransferRef[] | null>;
    /** Media referenced by this record, one entry per referenced asset. */
    media: TransferAssetRef[];
}

/** Which parts of the neighbourhood an export was asked to reach for. */
export interface TransferDepth {
    /** Pull related records in as full records (one hop). */
    relations: boolean;
    /** Carry asset bytes. Only a format with {@link carriesFileBytes} honours it. */
    media: boolean;
    /** Include every locale sibling of the selected records. */
    locales: boolean;
    /** Also include the locale siblings of related records. */
    relationLocales: boolean;
}

/** Depth with nothing switched on — the base every request is merged onto. */
export const NO_DEPTH: TransferDepth = {
    relations: false,
    media: false,
    locales: false,
    relationLocales: false
};

/** Depth an export uses when the caller names none. */
export const DEFAULT_DEPTH: TransferDepth = {
    relations: true,
    media: true,
    locales: true,
    // Off by default: it multiplies the payload by the locale count on top of
    // the relation count, which is a surprise nobody asked for.
    relationLocales: false
};

/** What the export counted, so a reader can tell a partial file from a whole one. */
export interface TransferCounts {
    /** Records the caller selected (plus their locale siblings). */
    roots: number;
    /** Records pulled in by a relation. */
    related: number;
    /** Distinct assets referenced. */
    assets: number;
    /** Total asset bytes, whether or not this format carries them. */
    assetBytes: number;
}

/** The document's header — everything an importer needs before reading a record. */
export interface TransferManifest {
    /** {@link TRANSFER_FORMAT_VERSION} at the time of export. */
    version: number;
    /** ISO timestamp of the export. */
    exportedAt: string;
    /**
     * The workspace the records came from. **Informational only** — an import
     * always stamps the workspace of the request that carries it, so a
     * hand-edited manifest cannot write across workspace boundaries.
     */
    sourceWorkspaceId: string;
    /** The type the export was rooted at. */
    rootType: string;
    /** What the export reached for. */
    depth: TransferDepth;
    /**
     * Identity fields per type, as the exporter resolved them. Carried so the
     * importer matches on the same fields the exporter keyed on, instead of
     * re-deriving them from a schema that may have drifted.
     */
    identity: Record<string, string[]>;
    counts: TransferCounts;
}

/** A whole export: the header plus every record it reached. */
export interface TransferDocument {
    manifest: TransferManifest;
    records: TransferRecord[];
}

/** Merges a partial depth request onto {@link DEFAULT_DEPTH}. */
export function resolveDepth(
    requested?: Partial<TransferDepth>
): TransferDepth {
    return { ...DEFAULT_DEPTH, ...(requested ?? {}) };
}

/**
 * A stable, order-independent string for a natural key — the map key an
 * importer matches on.
 *
 * JSON-encoded rather than joined with a separator character, because the parts
 * are user content: any separator you pick, a slug can contain. `["post","en",
 * "slug","a b"]` and `["post","en","slug a","b"]` are different strings here,
 * where a space- or colon-joined key would collapse them and quietly link two
 * unrelated records.
 *
 * `locale` participates because a localized type's key values are per-row: two
 * translations of one article legitimately share a slug on a type keyed by a
 * shared field, and always differ on one keyed by a localized field. Folding
 * the locale in is what keeps those two rows two rows.
 */
export function keyFingerprint(
    type: string,
    key: Record<string, string>,
    locale?: string
): string {
    const parts = Object.keys(key)
        .sort()
        .flatMap((field) => [field, key[field]]);
    return JSON.stringify([type, locale ?? '', ...parts]);
}

/** Whether a key has a usable value for every field it claims to be made of. */
export function isCompleteKey(
    key: Record<string, string>,
    fields: readonly string[]
): boolean {
    return (
        fields.length > 0 &&
        fields.every((field) => {
            const value = key[field];
            return typeof value === 'string' && value.length > 0;
        })
    );
}
