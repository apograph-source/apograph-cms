/**
 * The **one-hop graph walk** that an export is.
 *
 * The depth rule is the feature's central decision and it is enforced here, in
 * one loop rather than scattered across the readers: records the caller picked
 * are depth 0, records reached by following one of their links are depth 1, and
 * nothing is followed out of depth 1. Content graphs are almost always
 * connected, so a recursive walk would turn "export this article" into "export
 * the library" — reliably, and without warning.
 *
 * Stopping at one hop does *not* mean depth-1 records get useless links. Their
 * references are still emitted with a resolvable natural key, read by a cheap
 * key-only projection over the depth-2 rows. A reference carrying nothing but a
 * foreign row id would be unresolvable anywhere else, which is the whole
 * problem natural keys exist to solve — so the walk stops at the *records*, not
 * at the *references*.
 */

import { Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, isNull, type AnyColumn } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@apograph/database';
import { mediaAsset } from '@apograph/media-server';
import {
    CONTENT_FIELD_TYPE,
    EntryWriterService,
    InjectContentRegistry,
    InjectMediaAssetResolver,
    RelationLinkService,
    type AnyContentType,
    type ContentTypeRegistry,
    type MediaAssetResolver
} from '@apograph/content-server';
import {
    TransferLimitError,
    naturalKeyOf,
    owningRelationFields,
    type TransferAssetRef,
    type TransferCounts,
    type TransferDepth,
    type TransferDepthLevel,
    type TransferLimits,
    type TransferRecord,
    type TransferRef,
    type TransferTypeSchema
} from '@apograph/transfer-domain';
import { TransferSchemaCatalog } from '../../schema/schema-catalog.service';
import { InjectTransferLimits } from '../../transfer.tokens';

/** A generated content table row. */
type Row = Record<string, unknown>;

/** What to walk. */
export interface WalkRequest {
    type: AnyContentType;
    /** The selected root ids. */
    ids: readonly string[];
    workspaceId: string;
    depth: TransferDepth;
}

/** An asset the walk found, with everything an archive member needs. */
export interface WalkedAsset {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    checksum?: string;
    alt?: string | null;
    storageKey: string;
    /** Path this asset takes inside an archive. */
    path: string;
}

/** What the walk produced. */
export interface WalkResult {
    records: TransferRecord[];
    /** Distinct assets referenced, keyed by asset id. */
    assets: Map<string, WalkedAsset>;
    counts: TransferCounts;
}

/** `type:id`, the key both visit sets use. */
function nodeKey(type: string, id: string): string {
    return `${type} ${id}`;
}

@Injectable()
export class EntryGraphWalker {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly relations: RelationLinkService,
        private readonly catalog: TransferSchemaCatalog,
        @InjectTransferLimits() private readonly limits: TransferLimits,
        // Absent when the media plugin isn't registered — media fields then
        // export as bare ids rather than failing the whole transfer.
        @Optional()
        @InjectMediaAssetResolver()
        private readonly media?: MediaAssetResolver
    ) {}

    /** Walks the graph and returns the document's records plus its assets. */
    async walk(request: WalkRequest): Promise<WalkResult> {
        const { type, workspaceId, depth } = request;

        const rootRows = await this.loadRoots(request);
        const visited = new Set<string>(
            rootRows.map((row) => nodeKey(type.name, row['id'] as string))
        );

        // Depth 0. Building these also collects every neighbour the walk may
        // follow, so the relation reads below are batched per type rather than
        // issued per record.
        const built = await this.buildRecords(type, rootRows, 0);
        const records = [...built.records];
        let neighbours = built.neighbours;
        const assetIds = new Set(built.assetIds);

        if (depth.relations) {
            const relatedRows = await this.loadNeighbours(
                neighbours,
                visited,
                workspaceId,
                depth.relationLocales
            );
            for (const [typeName, rows] of relatedRows) {
                const target = this.registry.get(typeName);
                if (!target) continue;
                const level = await this.buildRecords(target, rows, 1);
                records.push(...level.records);
                // Depth-2 neighbours: not exported, but their keys are needed
                // so the depth-1 records' references resolve elsewhere.
                neighbours = mergeNeighbours(neighbours, level.neighbours);
                for (const id of level.assetIds) assetIds.add(id);
            }
        }

        this.assertEntryLimit(records.length);

        // Fill in every reference's natural key, including the depth-2 ones the
        // walk deliberately did not export.
        await this.resolveRefKeys(records, neighbours, workspaceId);

        const assets = depth.media
            ? await this.loadAssets(assetIds, workspaceId)
            : new Map<string, WalkedAsset>();
        this.attachAssetDetail(records, assets);

        const roots = records.filter((record) => record.$depth === 0).length;
        return {
            records,
            assets,
            counts: {
                roots,
                related: records.length - roots,
                assets: assets.size,
                assetBytes: [...assets.values()].reduce(
                    (total, asset) => total + asset.size,
                    0
                )
            }
        };
    }

    /** The selected rows, plus their locale siblings when asked for. */
    private async loadRoots(request: WalkRequest): Promise<Row[]> {
        const { type, ids, workspaceId, depth } = request;
        const byId = await this.writer.loadLiveByIds(
            type,
            [...ids],
            workspaceId
        );
        const rows = [...byId.values()];
        if (!depth.locales || !type.i18n || rows.length === 0) return rows;
        return this.withLocaleSiblings(type, rows, workspaceId);
    }

    /**
     * Adds every locale sibling of `rows`.
     *
     * Note what this reads: `locale_group_id`, an **envelope column**
     * content-server defines itself for any `i18n: true` type. Transfer never
     * learns what a locale *means* — it reads "the other rows of this record"
     * generically, which is why localization needs no port here and this plugin
     * has no dependency on the i18n plugin at all.
     */
    private async withLocaleSiblings(
        type: AnyContentType,
        rows: Row[],
        workspaceId: string
    ): Promise<Row[]> {
        const columns = type.table as unknown as Record<string, AnyColumn>;
        const groups = [
            ...new Set(
                rows
                    .map((row) => row['localeGroupId'] as string | undefined)
                    .filter((group): group is string => !!group)
            )
        ];
        if (groups.length === 0) return rows;

        const siblings = (await this.db
            .select()
            .from(type.table)
            .where(
                and(
                    inArray(columns['localeGroupId'], groups),
                    eq(columns['workspaceId'], workspaceId),
                    type.paranoid ? isNull(columns['deletedAt']) : undefined
                )
            )) as Row[];

        const seen = new Set(rows.map((row) => row['id'] as string));
        for (const sibling of siblings) {
            if (!seen.has(sibling['id'] as string)) rows.push(sibling);
        }
        return rows;
    }

    /** Turns rows into records, collecting their neighbours and asset ids. */
    private async buildRecords(
        type: AnyContentType,
        rows: readonly Row[],
        level: TransferDepthLevel
    ): Promise<{
        records: TransferRecord[];
        neighbours: Map<string, Set<string>>;
        assetIds: Set<string>;
    }> {
        const schema = this.catalog.schemaOf(type.name);
        const records: TransferRecord[] = [];
        const neighbours = new Map<string, Set<string>>();
        const assetIds = new Set<string>();
        if (!schema) return { records, neighbours, assetIds };

        const identity = this.catalog.identityFieldsOf(type.name);
        const owning = owningRelationFields(schema);
        const joinBacked = owning.filter((field) => field.relation?.many);

        // Join-table links are read per row; the single-relation FKs already
        // ride the row. Bounded fan-out so a large export can't take the whole
        // connection pool for one request.
        const links = await this.readLinks(type, rows, joinBacked.length > 0);

        for (const row of rows) {
            const id = row['id'] as string;
            const values: Record<string, unknown> = {};
            const relationRefs: Record<
                string,
                TransferRef | TransferRef[] | null
            > = {};

            for (const field of schema.fields) {
                const relation = field.relation;
                if (relation) {
                    if (relation.inverse) continue;
                    if (relation.many) {
                        const targets = links.get(id)?.[field.name] ?? [];
                        relationRefs[field.name] = targets.map((targetId) =>
                            this.pendingRef(relation.to, targetId, neighbours)
                        );
                    } else {
                        const targetId = row[field.name] as string | null;
                        relationRefs[field.name] = targetId
                            ? this.pendingRef(relation.to, targetId, neighbours)
                            : null;
                    }
                    continue;
                }

                const value = row[field.name] ?? null;
                values[field.name] = normalizeValue(value);
                if (field.type === CONTENT_FIELD_TYPE.Media) {
                    for (const assetId of mediaIdsOf(value)) {
                        assetIds.add(assetId);
                    }
                }
            }

            records.push({
                $type: type.name,
                $id: id,
                $key: naturalKeyOf(identity, values),
                $depth: level,
                ...(type.i18n
                    ? {
                          $locale: row['locale'] as string,
                          $localeGroup: row['localeGroupId'] as string
                      }
                    : {}),
                ...(type.publishable
                    ? { $status: row['status'] as TransferRecord['$status'] }
                    : {}),
                values,
                relations: relationRefs,
                media: mediaRefsOf(schema, row)
            });
        }

        return { records, neighbours, assetIds };
    }

    /** Reads every row's join-backed links, a bounded number of rows at a time. */
    private async readLinks(
        type: AnyContentType,
        rows: readonly Row[],
        needed: boolean
    ): Promise<Map<string, Record<string, string[]>>> {
        const links = new Map<string, Record<string, string[]>>();
        if (!needed) return links;
        // `snapshotLinks` reads one row's complete, ordered link set — the
        // whole set, deliberately, where the records table's preview reads one
        // capped page. An export that dropped a record's 300th tag would
        // silently lose data on re-import.
        const CONCURRENCY = 8;
        for (let i = 0; i < rows.length; i += CONCURRENCY) {
            const slice = rows.slice(i, i + CONCURRENCY);
            const snapshots = await Promise.all(
                slice.map((row) =>
                    this.relations.snapshotLinks(this.db, type, row)
                )
            );
            slice.forEach((row, index) => {
                links.set(row['id'] as string, snapshots[index]);
            });
        }
        return links;
    }

    /** Records a neighbour and returns the reference that will name it. */
    private pendingRef(
        targetType: string,
        targetId: string,
        neighbours: Map<string, Set<string>>
    ): TransferRef {
        const bucket = neighbours.get(targetType) ?? new Set<string>();
        bucket.add(targetId);
        neighbours.set(targetType, bucket);
        // `$key` is filled in by `resolveRefKeys` once every row is known.
        return { $type: targetType, $id: targetId, $key: {} };
    }

    /** Loads the depth-1 rows, skipping anything already visited. */
    private async loadNeighbours(
        neighbours: Map<string, Set<string>>,
        visited: Set<string>,
        workspaceId: string,
        includeLocales: boolean
    ): Promise<Map<string, Row[]>> {
        const out = new Map<string, Row[]>();
        for (const [typeName, ids] of neighbours) {
            const target = this.registry.get(typeName);
            if (!target) continue;
            const wanted = [...ids].filter(
                (id) => !visited.has(nodeKey(typeName, id))
            );
            if (wanted.length === 0) continue;

            const byId = await this.writer.loadLiveByIds(
                target,
                wanted,
                workspaceId
            );
            let rows = [...byId.values()];
            if (includeLocales && target.i18n && rows.length > 0) {
                rows = await this.withLocaleSiblings(target, rows, workspaceId);
            }
            for (const row of rows) {
                visited.add(nodeKey(typeName, row['id'] as string));
            }
            if (rows.length > 0) out.set(typeName, rows);
        }
        return out;
    }

    /**
     * Fills every reference's `$key`.
     *
     * Two records may point at the same neighbour, so this is indexed once by
     * `type:id` and read back, rather than resolved per reference. Rows already
     * exported contribute their keys for free; the rest — the depth-2
     * neighbours the walk did not follow — are read with a projection over just
     * their identity columns, which is cheap and is what makes "import will
     * link it if it finds it" true rather than aspirational.
     */
    private async resolveRefKeys(
        records: readonly TransferRecord[],
        neighbours: Map<string, Set<string>>,
        workspaceId: string
    ): Promise<void> {
        const keys = new Map<string, Record<string, string>>();
        const locales = new Map<string, string>();
        for (const record of records) {
            const node = nodeKey(record.$type, record.$id);
            keys.set(node, record.$key);
            if (record.$locale) locales.set(node, record.$locale);
        }

        for (const [typeName, ids] of neighbours) {
            const missing = [...ids].filter(
                (id) => !keys.has(nodeKey(typeName, id))
            );
            if (missing.length === 0) continue;
            const target = this.registry.get(typeName);
            const identity = this.catalog.identityFieldsOf(typeName);
            if (!target || identity.length === 0) continue;

            // `PgColumn` rather than `AnyColumn`: Drizzle's *select* builder
            // accepts the narrower type only — the same distinction
            // content-server draws for its own window previews.
            const columns = target.table as unknown as Record<string, PgColumn>;
            const projection: Record<string, PgColumn> = {
                id: columns['id']
            };
            for (const field of identity) {
                if (columns[field]) projection[field] = columns[field];
            }
            // A localized target's key is per-row, so the locale is part of what
            // identifies it and has to come back with the projection.
            if (target.i18n && columns['locale']) {
                projection['locale'] = columns['locale'];
            }
            const rows = (await this.db
                .select(projection)
                .from(target.table)
                .where(
                    and(
                        inArray(columns['id'], missing),
                        eq(columns['workspaceId'], workspaceId),
                        target.paranoid
                            ? isNull(columns['deletedAt'])
                            : undefined
                    )
                )) as Row[];
            for (const row of rows) {
                const node = nodeKey(typeName, row['id'] as string);
                keys.set(node, naturalKeyOf(identity, row));
                const locale = row['locale'];
                if (typeof locale === 'string') locales.set(node, locale);
            }
        }

        for (const record of records) {
            for (const value of Object.values(record.relations)) {
                const refs =
                    value == null ? [] : Array.isArray(value) ? value : [value];
                for (const ref of refs) {
                    if (!ref.$id) continue;
                    const node = nodeKey(ref.$type, ref.$id);
                    const key = keys.get(node);
                    if (key) ref.$key = { ...key };
                    const locale = locales.get(node);
                    if (locale) ref.$locale = locale;
                }
            }
        }
    }

    /** Reads the referenced assets' rows, honouring the asset and byte ceilings. */
    private async loadAssets(
        assetIds: ReadonlySet<string>,
        workspaceId: string
    ): Promise<Map<string, WalkedAsset>> {
        const out = new Map<string, WalkedAsset>();
        if (assetIds.size === 0) return out;
        if (assetIds.size > this.limits.maxAssets) {
            throw new TransferLimitError(
                `This export would carry ${assetIds.size} files, over the limit of ${this.limits.maxAssets}. Narrow the selection or turn off files.`,
                'maxAssets'
            );
        }
        if (!this.media) return out;

        // The resolver is the workspace-scoped lookup: an id naming an asset in
        // another workspace is simply absent from the result, so a hand-crafted
        // reference cannot pull bytes across the boundary.
        const resolved = await this.media.resolve([...assetIds], workspaceId);
        let bytes = 0;
        for (const [id, asset] of resolved) {
            const detail = await this.assetDetail(id, workspaceId);
            if (!detail) continue;
            bytes += detail.size;
            if (bytes > this.limits.maxBytes) {
                throw new TransferLimitError(
                    `This export would carry more than ${this.limits.maxBytes} bytes of files. Narrow the selection or turn off files.`,
                    'maxBytes'
                );
            }
            out.set(id, {
                id,
                name: asset.name,
                mimeType: asset.mimeType,
                alt: asset.alt,
                ...detail,
                path: `assets/${id}/${safeFileName(asset.name)}`
            });
        }
        return out;
    }

    /**
     * The storage-level facts the resolver port doesn't carry — the size, the
     * checksum, and the key the bytes live under.
     *
     * Read straight from the media plugin's own table rather than added to
     * `MediaAssetResolver`: that port exists so content can *validate* a media
     * field without knowing what a media plugin is, and widening it with a
     * storage key would push storage concerns into every implementor of it.
     */
    private async assetDetail(
        id: string,
        workspaceId: string
    ): Promise<
        { size: number; checksum?: string; storageKey: string } | undefined
    > {
        const rows = (await this.db
            .select({
                size: mediaAsset.size,
                checksum: mediaAsset.checksum,
                storageKey: mediaAsset.storageKey
            })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.id, id),
                    eq(mediaAsset.workspaceId, workspaceId)
                )
            )) as {
            size: number;
            checksum: string | null;
            storageKey: string;
        }[];
        const row = rows[0];
        if (!row) return undefined;
        return {
            size: row.size,
            ...(row.checksum ? { checksum: row.checksum } : {}),
            storageKey: row.storageKey
        };
    }

    /** Fills each record's media refs from the resolved asset detail. */
    private attachAssetDetail(
        records: readonly TransferRecord[],
        assets: ReadonlyMap<string, WalkedAsset>
    ): void {
        for (const record of records) {
            for (const ref of record.media) {
                const asset = assets.get(ref.$id);
                if (!asset) continue;
                ref.name = asset.name;
                ref.mimeType = asset.mimeType;
                ref.size = asset.size;
                ref.path = asset.path;
                if (asset.checksum) ref.checksum = asset.checksum;
                if (asset.alt !== undefined) ref.alt = asset.alt;
            }
        }
    }

    private assertEntryLimit(count: number): void {
        if (count > this.limits.maxEntries) {
            throw new TransferLimitError(
                `This export would carry ${count} records, over the limit of ${this.limits.maxEntries}. Narrow the selection, or turn off related records.`,
                'maxEntries'
            );
        }
    }
}

/** Reads a media field's value as a list of asset ids. */
function mediaIdsOf(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    return [];
}

/** The bare media references of one row, before asset detail is filled in. */
function mediaRefsOf(schema: TransferTypeSchema, row: Row): TransferAssetRef[] {
    const refs: TransferAssetRef[] = [];
    for (const field of schema.fields) {
        if (field.type !== CONTENT_FIELD_TYPE.Media) continue;
        for (const id of mediaIdsOf(row[field.name])) {
            refs.push({
                field: field.name,
                $id: id,
                name: id,
                mimeType: 'application/octet-stream',
                size: 0
            });
        }
    }
    return refs;
}

/** Dates become ISO strings so the document is plain JSON in every format. */
function normalizeValue(value: unknown): unknown {
    return value instanceof Date ? value.toISOString() : value;
}

/**
 * A file name safe to place inside an archive.
 *
 * The asset id is already the directory, so this only has to stay readable and
 * stay one path segment — a slash or a `..` in a stored name must never become
 * structure.
 */
function safeFileName(name: string): string {
    const cleaned = name
        .replace(/[/\\]/g, '_')
        .replace(/\0/g, '')
        .replace(/^\.+/, '')
        .trim();
    return cleaned.length > 0 ? cleaned.slice(0, 180) : 'file';
}

/** Folds one neighbour map into another. */
function mergeNeighbours(
    into: Map<string, Set<string>>,
    from: Map<string, Set<string>>
): Map<string, Set<string>> {
    for (const [type, ids] of from) {
        const bucket = into.get(type) ?? new Set<string>();
        for (const id of ids) bucket.add(id);
        into.set(type, bucket);
    }
    return into;
}
