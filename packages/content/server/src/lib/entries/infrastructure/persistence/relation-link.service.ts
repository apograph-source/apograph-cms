import {
    BadRequestException,
    Injectable,
    Optional,
    UnprocessableEntityException
} from '@nestjs/common';
import {
    and,
    asc,
    count,
    eq,
    getTableName,
    inArray,
    isNull,
    max,
    notInArray,
    sql,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import {
    ENTRY_STATUS,
    type AnyContentType,
    type EntryStatus
} from '../../../types/content-type';
import { CONTENT_FIELD_TYPE, type AnyFieldSpec } from '../../../types/fields';
import { ContentReadScopeRegistry } from '../../../extension/read-scope';
import type {
    RelationDelta,
    RelationFieldView,
    RelationRef
} from '../../types/entry-list-view';
import { entrySlug, entryTitle } from './entry-row';

/** A generated content/join table seen as a bag of columns by property name. */
type Columns = Record<string, AnyColumn>;

/**
 * Reject any target row that lives in a different locale from the source.
 *
 * Two **i18n** types must link inside one locale. A cross-locale link is a
 * broken model rather than a preference: the English article would render the
 * German tag, and since links are per-row rather than synced across a
 * translation group, nothing later repairs it. The admin has always enforced
 * this by only offering same-locale candidates in its relation picker; this is
 * the same rule at the layer a direct API call cannot skip.
 *
 * A no-op unless BOTH sides are localized — `sourceLocale` is `undefined` for a
 * non-i18n owner, and a non-i18n target has no locale to disagree about.
 *
 * Exported so `EntryWriterService` applies the identical rule to the owning
 * **single** relations it validates itself (a `<field>_id` FK never reaches the
 * join-table paths), instead of the two growing their own versions of it.
 */
export function assertSameLocale(
    rows: Row[],
    target: AnyContentType,
    field: string,
    sourceLocale: string | undefined
): void {
    if (!sourceLocale || !target.i18n) return;
    const foreign = rows.filter((row) => row['locale'] !== sourceLocale);
    if (!foreign.length) return;
    throw new UnprocessableEntityException({
        message: 'Entry validation failed',
        issues: foreign.map((row) => ({
            field,
            message:
                `must reference a "${sourceLocale}" entry — ` +
                `"${row['id'] as string}" is "${row['locale'] as string}". ` +
                'Link the translation of that record in this entry’s locale.'
        }))
    });
}

/**
 * The same bag typed as `PgColumn` rather than `AnyColumn` — needed where a
 * column is fed to Drizzle's *select* builder (as the window previews do), whose
 * `SelectedFieldsFlat` accepts `PgColumn` but not the broader `AnyColumn`.
 */
type SelectableColumns = Record<string, PgColumn>;

/** A generated content row seen as a bag of values by property name. */
type Row = Record<string, unknown>;

/** Default links per page when the caller doesn't specify one. */
export const RELATION_PAGE_SIZE = 20;

/**
 * Extra visibility applied to a relation's **targets**, on top of the workspace
 * scope and soft-delete guard every read already applies.
 *
 * Exists for the public content API, which serves published entries only: a
 * relation preview there must not surface a draft target's title, and must not
 * *count* it either, or `total` would advertise links the caller can never see.
 * Absent (the admin's every call site) nothing changes — an editor legitimately
 * links to drafts and needs to see them.
 */
export interface RelationTargetVisibility {
    /**
     * Restrict targets to entries that are currently published.
     *
     * It also turns on the bound **read scopes** — segments' reader
     * entitlements — against the target type. The two ride one flag because
     * they answer one question ("may this caller reach this target?") and are
     * needed at exactly the same call sites: every public read passes it, and
     * no admin read does. A second flag would be a second thing to remember on
     * a path where forgetting it means counting links a reader cannot follow.
     */
    publishedOnly?: boolean;
}

/**
 * How many relation fields are resolved at once — by the page preview and by
 * the per-entry {@link RelationLinkService.readAll}. `relationFields` is
 * bounded in bytes but not in count, so a type with many relation columns could
 * otherwise fan out one concurrent query per field — and each field takes a
 * connection twice (its window query, then `refsFor`). The pool is small and
 * app-wide, so cap the fan-out and let the remainder queue in-process rather
 * than in the pool, where it would block unrelated requests.
 */
const RELATION_FIELD_CONCURRENCY = 3;

/**
 * A private advisory-lock class (the first `pg_advisory_xact_lock` key)
 * namespacing the per-source append locks, so their hashed `<table>:<sourceId>`
 * keys can't collide with any other advisory lock the app takes (e.g. identity's
 * per-workspace lock). Arbitrary but fixed.
 */
const RELATION_APPEND_LOCK_CLASS = 0x524c; // 'RL'

/**
 * The transaction handle Drizzle hands the `db.transaction(tx => …)` callback —
 * derived from {@link Database} so link writes share the exact query surface of
 * the client without hard-coding the dialect's transaction type.
 */
export type DbTransaction = Parameters<
    Parameters<Database['transaction']>[0]
>[0];

/**
 * Anything that can run a SELECT — the pooled client or a transaction handle.
 * Lets the locale-group resolver serve both the in-transaction link writes and
 * the pre-transaction single-relation resolution without duplicating itself.
 */
export type QueryRunner = Pick<Database, 'select'>;

/**
 * Where a join-backed relation field's links physically live, normalized so the
 * read and write paths treat every one the same. `table` is the join table;
 * `ownCol` holds the editing record's id, `refCol` the linked target's — swapped
 * for an inverse of a many-to-many, which reuses the owning side's join table.
 */
interface JoinPlan {
    table: PgTable;
    /** Property name of the column holding the editing record's id. */
    ownCol: 'sourceId' | 'targetId';
    /** Property name of the column holding the linked target's id. */
    refCol: 'sourceId' | 'targetId';
    /** The content type the linked ids belong to. */
    target: AnyContentType;
}

/** Where an inverse-of-single (one-to-many) field reads from: the owner table. */
interface InversePlan {
    table: PgTable;
    /** The owning FK column (property name) pointing back at the editing record. */
    fkCol: string;
    target: AnyContentType;
}

/**
 * Reads and writes the relation **links** an entry owns beyond its own columns:
 * many-to-many join rows and the inverse (back-reference) side of a two-way
 * relation. Owning **single** relations are plain `<field>_id` FK columns —
 * written by `toColumns`, read off the row — so they need no join plumbing.
 *
 * Everything is **paginated**: a relation can hold thousands of links, so reads
 * return one ordered page + a `total` (never every id), and writes apply an
 * incremental {@link RelationDelta} (link / unlink / reorder) inside a
 * transaction — so a huge relation never has to be sent or held in full.
 * Order is persisted in the join table's `position` column, owned by the
 * **source** side; the inverse reads by it (stable) but can't reorder it.
 */
@Injectable()
export class RelationLinkService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        // The bound read scopes (`@orthacms/segments-server`'s reader
        // entitlements), consulted about a relation's **target** type on the
        // public reads only. Optional so this service still resolves in a
        // context that binds no scope — an empty registry costs a length check.
        @Optional()
        private readonly readScopes?: ContentReadScopeRegistry
    ) {}

    // ---- reads -------------------------------------------------------------

    /**
     * First page (+ total) of **every** relation field of `type` for one entry,
     * keyed by field name — what the editor loads on open. Each field is read
     * independently (paginated), so a relation with many links contributes only
     * its first page, not every id.
     *
     * Admin-only, hence no {@link RelationTargetVisibility}: an editor must see
     * the draft targets it may be about to publish. The public API reads links
     * one field at a time through {@link readField}, which takes the flag.
     */
    async readAll(
        type: AnyContentType,
        row: Row,
        workspaceId: string,
        pageSize = RELATION_PAGE_SIZE
    ): Promise<Record<string, RelationFieldView>> {
        // Each relation field is an independent read, so fan them out
        // concurrently rather than awaiting one before starting the next — a
        // type with several relations pays one field's latency, not their sum.
        //
        // Bounded by the same cap as `previewForEntries`, and for the same
        // reason: the pool is small (10 by default) and app-wide, while each
        // field takes a connection for its page + count and then again for
        // `refsFor`. Unbounded, a type with several relation fields could let a
        // couple of concurrent editor opens occupy every connection and queue
        // unrelated traffic behind them — the exact hazard the preview path
        // already guards, which this read simply hadn't caught up with.
        const fields = Object.entries(type.fields).filter(
            ([, spec]) =>
                spec.type === CONTENT_FIELD_TYPE.Relation && spec.relation
        );
        const views: RelationFieldView[] = [];
        for (let i = 0; i < fields.length; i += RELATION_FIELD_CONCURRENCY) {
            views.push(
                ...(await Promise.all(
                    fields
                        .slice(i, i + RELATION_FIELD_CONCURRENCY)
                        .map(([name, spec]) =>
                            this.readField(
                                type,
                                row,
                                name,
                                spec,
                                1,
                                pageSize,
                                workspaceId
                            )
                        )
                ))
            );
        }
        const out: Record<string, RelationFieldView> = {};
        fields.forEach(([name], i) => {
            out[name] = views[i];
        });
        return out;
    }

    /**
     * A capped relation preview for a whole **page** of entries — what the
     * records table's relation columns render. Returns, per entry id, a
     * `{ items, total }` view for each requested field.
     *
     * The batching is the point: this issues a constant number of queries **per
     * relation field**, spanning every row on the page (`inArray(ownCol, ids)`),
     * never one query per row. Contrast {@link readAll}, which is scoped to a
     * single entry (`eq(ownCol, row.id)`) because the editor opens one record —
     * calling it in a loop over a page would be a textbook N+1 (a 50-row page
     * with two relation columns would cost 300 queries; this costs a handful).
     *
     * Each field contributes at most `pageSize` refs plus its true `total`, so a
     * record holding thousands of links reads exactly one page here — the
     * dropdown pages through the rest via {@link readField}. Only `fields` are
     * resolved (the table's visible columns), so a hidden relation column costs
     * nothing.
     */
    async previewForEntries(
        type: AnyContentType,
        fields: string[],
        rows: Row[],
        workspaceId: string,
        pageSize = RELATION_PAGE_SIZE,
        visibility?: RelationTargetVisibility
    ): Promise<Map<string, Record<string, RelationFieldView>>> {
        const out = new Map<string, Record<string, RelationFieldView>>();
        const sourceIds = rows
            .map((row) => row['id'])
            .filter((id): id is string => typeof id === 'string' && !!id);
        const specs = fields
            .map((name) => [name, type.fields[name]] as const)
            .filter(
                (entry): entry is readonly [string, AnyFieldSpec] =>
                    entry[1]?.type === CONTENT_FIELD_TYPE.Relation &&
                    !!entry[1].relation
            );
        if (!sourceIds.length || !specs.length) return out;
        for (const id of sourceIds) out.set(id, {});

        // Each relation field is an independent read, so fan them out
        // concurrently rather than awaiting one before starting the next — a
        // table with several relation columns pays one field's latency, not
        // their sum (the same reasoning as `readAll`).
        //
        // Bounded, though: the pool is small and shared app-wide, and each
        // field holds a connection for its window query and then another for
        // `refsFor`. A type with many relation columns would otherwise let a
        // couple of list requests occupy every connection, queueing unrelated
        // traffic behind a records table's previews.
        const views: Map<string, RelationFieldView>[] = [];
        for (let i = 0; i < specs.length; i += RELATION_FIELD_CONCURRENCY) {
            const batch = specs.slice(i, i + RELATION_FIELD_CONCURRENCY);
            views.push(
                ...(await Promise.all(
                    batch.map(([name, spec]) =>
                        this.previewField(
                            type,
                            name,
                            spec,
                            rows,
                            sourceIds,
                            workspaceId,
                            pageSize,
                            visibility
                        )
                    )
                ))
            );
        }
        specs.forEach(([name], index) => {
            for (const [sourceId, view] of views[index]) {
                const bucket = out.get(sourceId);
                if (bucket) bucket[name] = view;
            }
        });
        return out;
    }

    /**
     * Preview one relation field across the page, dispatched by storage form —
     * the same three shapes {@link readField} handles: an owning single relation
     * (FK on the row), a join-backed relation (owning many-to-many or the
     * inverse of one), and an inverse-of-single (the owner's FK points back).
     */
    private previewField(
        type: AnyContentType,
        field: string,
        spec: AnyFieldSpec,
        rows: Row[],
        sourceIds: string[],
        workspaceId: string,
        pageSize: number,
        visibility?: RelationTargetVisibility
    ): Promise<Map<string, RelationFieldView>> {
        const relation = spec.relation;
        if (!relation) return Promise.resolve(new Map());
        if (!relation.many && !relation.inverse)
            return this.previewSingle(
                relation.to(),
                field,
                rows,
                workspaceId,
                visibility
            );

        const join = this.joinPlanFor(type, field, spec);
        if (join)
            return this.previewJoin(
                join,
                sourceIds,
                workspaceId,
                pageSize,
                visibility
            );

        const inverse = this.inversePlanFor(spec);
        if (inverse)
            return this.previewInverse(
                inverse,
                sourceIds,
                workspaceId,
                pageSize,
                visibility
            );
        return Promise.resolve(new Map());
    }

    /**
     * Owning **single** relations: the FK already rides each page row, so this
     * is one batched {@link refsFor} for every row's target at once — which also
     * de-duplicates, so 50 posts sharing one author resolve that title once
     * instead of 50 times.
     */
    private async previewSingle(
        target: AnyContentType,
        field: string,
        rows: Row[],
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ): Promise<Map<string, RelationFieldView>> {
        const fkBySource = new Map<string, string>();
        for (const row of rows) {
            const fk = row[field];
            const id = row['id'];
            if (typeof fk === 'string' && fk && typeof id === 'string')
                fkBySource.set(id, fk);
        }
        const out = new Map<string, RelationFieldView>();
        if (!fkBySource.size) return out;

        const refs = await this.refsFor(
            target,
            [...fkBySource.values()],
            workspaceId,
            visibility
        );
        const refById = new Map(refs.map((ref) => [ref.id, ref]));
        for (const [sourceId, fk] of fkBySource) {
            // Under a visibility restriction an unresolvable target is one the
            // caller may not see, so the link is reported as absent rather than
            // as a `missing` ref — a public consumer must not learn that a
            // hidden record is linked here, and `total` must not count it.
            if (visibility?.publishedOnly && !refById.has(fk)) {
                out.set(sourceId, { items: [], total: 0 });
                continue;
            }
            // `refsFor` is total — it yields a ref for every id, id-only and
            // flagged `missing` when the target is gone. So the link is always
            // represented (`total` counts the link, not whether its target
            // resolved, exactly as `readField` reports it), and it is the flag,
            // not an absent item, that tells the UI the target is unavailable.
            const ref: RelationRef = refById.get(fk) ?? {
                id: fk,
                title: fk,
                missing: true
            };
            out.set(sourceId, { items: [ref], total: 1 });
        }
        return out;
    }

    /**
     * Join-backed relations (owning many-to-many, or the inverse of one), ranked
     * in a single windowed pass: `row_number()` applies the per-source page cap
     * and `count(*)` the true total, both partitioned by the owning id. That is
     * what keeps a 600-link record to `pageSize` rows read instead of 600.
     */
    private async previewJoin(
        join: JoinPlan,
        sourceIds: string[],
        workspaceId: string,
        pageSize: number,
        visibility?: RelationTargetVisibility
    ): Promise<Map<string, RelationFieldView>> {
        const cols = join.table as unknown as SelectableColumns;
        const own = cols[join.ownCol];
        const ref = cols[join.refCol];
        const position = cols['position'];

        const ranked = this.db
            .select({
                own,
                ref,
                rn: sql<number>`row_number() over (partition by ${own} order by ${position} asc, ${ref} asc)`.as(
                    'rn'
                ),
                total: sql<number>`count(*) over (partition by ${own})`.as(
                    'total'
                )
            })
            .from(join.table)
            .where(
                and(
                    inArray(own, sourceIds),
                    // Applied INSIDE the window, not after it: `count(*) over`
                    // is computed here, so filtering later would page over
                    // hidden links and report a total the caller can't reach.
                    this.visibleTargetIdsPredicate(
                        ref,
                        join.target,
                        workspaceId,
                        visibility
                    )
                )
            )
            .as('ranked');

        // The window aliases (`rn`/`own`) carry no column type through the
        // subquery, so compare and order them as raw fragments rather than via
        // `lte`/`asc`, whose overloads can't resolve an untyped alias.
        const rows = (await this.db
            .select()
            .from(ranked)
            .where(sql`${ranked.rn} <= ${pageSize}`)
            .orderBy(sql`${ranked.own} asc, ${ranked.rn} asc`)) as Row[];

        return this.groupPreview(
            rows,
            'ref',
            await this.refsFor(
                join.target,
                rows.map((row) => row['ref'] as string),
                workspaceId,
                visibility
            )
        );
    }

    /**
     * Inverse-of-single (one-to-many): the links are the owner rows whose FK
     * points back at each page row. Windowed the same way, and scoped to the
     * workspace with the soft-delete guard the inverse read side already applies.
     */
    private async previewInverse(
        inverse: InversePlan,
        sourceIds: string[],
        workspaceId: string,
        pageSize: number,
        visibility?: RelationTargetVisibility
    ): Promise<Map<string, RelationFieldView>> {
        const cols = inverse.table as unknown as SelectableColumns;
        const fk = cols[inverse.fkCol];
        const ranked = this.db
            .select({
                own: fk,
                ref: cols['id'],
                rn: sql<number>`row_number() over (partition by ${fk} order by ${cols['createdAt']} asc, ${cols['id']} asc)`.as(
                    'rn'
                ),
                total: sql<number>`count(*) over (partition by ${fk})`.as(
                    'total'
                )
            })
            .from(inverse.table)
            .where(
                and(
                    inArray(fk, sourceIds),
                    // The window reads the TARGET table here (the owners whose
                    // FK points back), so the restriction is a plain column
                    // predicate rather than a sub-select.
                    this.targetVisibleWhere(
                        inverse.target,
                        workspaceId,
                        visibility
                    )
                )
            )
            .as('ranked');

        const rows = (await this.db
            .select()
            .from(ranked)
            .where(sql`${ranked.rn} <= ${pageSize}`)
            .orderBy(sql`${ranked.own} asc, ${ranked.rn} asc`)) as Row[];

        return this.groupPreview(
            rows,
            'ref',
            await this.refsFor(
                inverse.target,
                rows.map((row) => row['ref'] as string),
                workspaceId,
                visibility
            )
        );
    }

    /**
     * Fold ranked window rows (already ordered by owner, then rank) into one
     * `{ items, total }` view per owning id, resolving each link through the
     * batched `refs`. Shared by the join-backed and inverse previews.
     */
    private groupPreview(
        rows: Row[],
        refKey: string,
        refs: RelationRef[]
    ): Map<string, RelationFieldView> {
        const refById = new Map(refs.map((ref) => [ref.id, ref]));
        const out = new Map<string, RelationFieldView>();
        for (const row of rows) {
            const sourceId = row['own'] as string;
            let view = out.get(sourceId);
            if (!view) {
                view = { items: [], total: Number(row['total']) };
                out.set(sourceId, view);
            }
            // `refsFor` resolved every ranked id, so there is always a ref —
            // id-only and flagged `missing` where the target is soft-deleted or
            // out of workspace. Skipping it here would make `items` shorter
            // than `total` and leave the cell showing a phantom `+N`.
            const id = row[refKey] as string;
            view.items.push(
                refById.get(id) ?? { id, title: id, missing: true }
            );
        }
        return out;
    }

    /**
     * One page of a single relation field's links, ordered by `position`
     * (owning) and resolved to display-ready refs (id + title). `row` is the
     * editing entry (its FK columns back a single relation); pass it to avoid a
     * re-read. Returns `{ items, total }`.
     */
    async readField(
        type: AnyContentType,
        row: Row,
        field: string,
        spec: AnyFieldSpec,
        page: number,
        pageSize: number,
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ): Promise<RelationFieldView> {
        if (spec.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation)
            return { items: [], total: 0 };
        const offset = (page - 1) * pageSize;

        // Owning single relation: the id is the row's FK value (0 or 1 link).
        if (!spec.relation.many && !spec.relation.inverse) {
            const fk = row[field];
            const ids = typeof fk === 'string' && fk ? [fk] : [];
            const items =
                page === 1
                    ? await this.refsFor(
                          spec.relation.to(),
                          ids,
                          workspaceId,
                          visibility
                      )
                    : [];
            // Under a visibility restriction an unresolved target is hidden,
            // not `missing` — the link is reported as absent (see
            // `previewSingle` for why `total` must not count it).
            if (visibility?.publishedOnly && !items.some((ref) => !ref.missing))
                return { items: [], total: 0 };
            return { items, total: ids.length };
        }

        const join = this.joinPlanFor(type, field, spec);
        if (join) {
            const cols = join.table as unknown as Columns;
            const selectable = join.table as unknown as SelectableColumns;
            // One predicate for the page and the count, so a restricted read
            // can't report a total its pages never reach.
            const linkWhere = and(
                eq(cols[join.ownCol], row['id']),
                this.visibleTargetIdsPredicate(
                    selectable[join.refCol],
                    join.target,
                    workspaceId,
                    visibility
                )
            );
            const [rows, [{ total }]] = await Promise.all([
                this.db
                    .select()
                    .from(join.table)
                    .where(linkWhere)
                    .orderBy(asc(cols['position']), asc(cols[join.refCol]))
                    .limit(pageSize)
                    .offset(offset),
                this.db
                    .select({ total: count() })
                    .from(join.table)
                    .where(linkWhere)
            ]);
            const ids = (rows as Row[]).map((r) => r[join.refCol] as string);
            return {
                items: await this.refsFor(
                    join.target,
                    ids,
                    workspaceId,
                    visibility
                ),
                total: Number(total)
            };
        }

        const inverse = this.inversePlanFor(spec);
        if (inverse) {
            const cols = inverse.table as unknown as Columns;
            const where = and(
                eq(cols[inverse.fkCol], row['id']),
                this.targetVisibleWhere(inverse.target, workspaceId, visibility)
            );
            const [rows, [{ total }]] = await Promise.all([
                this.db
                    .select()
                    .from(inverse.table)
                    .where(where)
                    .orderBy(asc(cols['createdAt']), asc(cols['id']))
                    .limit(pageSize)
                    .offset(offset),
                this.db
                    .select({ total: count() })
                    .from(inverse.table)
                    .where(where)
            ]);
            return {
                items: (rows as Row[]).map((r) =>
                    this.rowToRef(inverse.target, r)
                ),
                total: Number(total)
            };
        }
        return { items: [], total: 0 };
    }

    /**
     * The **full** ordered target-id list of every join-backed relation field
     * (owning many-to-many and the inverse of one) for one entry, keyed by field
     * name — the relation half of a revision snapshot. Unlike {@link readAll}
     * (one page + a `total`, for the editor), this reads every link, since a
     * snapshot must reconstruct the whole set. Runs on the passed executor (the
     * save transaction), so it captures exactly what committed. Owning single
     * relations aren't included — their FK already rides the entry's `values`.
     * The join rows belong to the owning entry (scoped by `row.id`), so no
     * workspace filter is needed here — the same as the join read in
     * {@link readField}.
     */
    async snapshotLinks(
        exec: Database | DbTransaction,
        type: AnyContentType,
        row: Row
    ): Promise<Record<string, string[]>> {
        const out: Record<string, string[]> = {};
        for (const [field, spec] of Object.entries(type.fields)) {
            const join = this.joinPlanFor(type, field, spec);
            if (!join) continue; // single FK / inverse-of-single: not join-backed
            const cols = join.table as unknown as Columns;
            const rows = (await exec
                .select()
                .from(join.table)
                .where(eq(cols[join.ownCol], row['id']))
                .orderBy(
                    asc(cols['position']),
                    asc(cols[join.refCol])
                )) as Row[];
            out[field] = rows.map((r) => r[join.refCol] as string);
        }
        return out;
    }

    // ---- writes ------------------------------------------------------------

    /**
     * Apply an incremental {@link RelationDelta} to one many/inverse relation
     * field inside `tx`: validate the linked targets are in the workspace, unlink
     * the removed pairs, append the new ones (`position = max+1` for the source,
     * `ON CONFLICT DO NOTHING`), then renumber to `order` (owning side only).
     * A single relation or an inverse-of-single owns no delta-writable link, so
     * it's a no-op. Returns nothing — read the field back for the new state.
     */
    async applyDelta(
        tx: DbTransaction,
        type: AnyContentType,
        sourceId: string,
        field: string,
        delta: RelationDelta,
        workspaceId: string,
        sourceLocale?: string
    ): Promise<void> {
        const spec = type.fields[field];
        const join = spec ? this.joinPlanFor(type, field, spec) : null;
        if (!join) return; // single / inverse-of-single: nothing to write here

        // `by: 'localeGroup'` names translation groups rather than rows; resolve
        // them to this source's own locale before anything touches the join.
        const resolved =
            delta.by === 'localeGroup'
                ? await this.resolveByLocaleGroup(
                      tx,
                      join.target,
                      delta,
                      workspaceId,
                      field,
                      sourceLocale
                  )
                : delta;

        await this.assertTargets(
            tx,
            join.target,
            resolved.link ?? [],
            workspaceId,
            field,
            sourceLocale
        );
        const cols = join.table as unknown as Columns;
        const own = cols[join.ownCol];
        const ref = cols[join.refCol];

        if (resolved.unlink?.length) {
            await tx
                .delete(join.table)
                .where(and(eq(own, sourceId), inArray(ref, resolved.unlink)));
        }

        // Append each new link at the end of its **source's** ordered list.
        const links = dedupe(resolved.link);
        if (links.length && join.ownCol === 'sourceId') {
            // Owning relation: every new link shares this entry as its source, so
            // read the append base once and insert them all in a single
            // statement (position = base + index) instead of a SELECT+INSERT per
            // link inside the locked transaction. Take the source's append lock
            // first so a concurrent writer to the same list can't read the same
            // `max(position)` and produce a duplicate position (the inverse side
            // and a whole-set write both target this same physical list).
            await this.lockSource(tx, join.table, sourceId);
            const base = await this.nextPosition(tx, join.table, sourceId);
            await tx
                .insert(join.table)
                .values(
                    links.map(
                        (targetId, i) =>
                            ({
                                [join.ownCol]: sourceId,
                                [join.refCol]: targetId,
                                position: base + i
                            }) as never
                    )
                )
                .onConflictDoNothing();
        } else if (links.length) {
            // Inverse relation: each link appends to a **different** owner row's
            // list (its physical source is the linked owner, not this entry), so
            // each needs its own append base — and its own append lock. Lock (and
            // append) in a stable sorted order so two transactions touching an
            // overlapping owner set can't deadlock by taking the locks in
            // opposite orders.
            for (const targetId of [...links].sort()) {
                await this.lockSource(tx, join.table, targetId);
                const position = await this.nextPosition(
                    tx,
                    join.table,
                    targetId
                );
                await tx
                    .insert(join.table)
                    .values({
                        [join.ownCol]: sourceId,
                        [join.refCol]: targetId,
                        position
                    } as never)
                    .onConflictDoNothing();
            }
        }

        // Reorder is the owning side's prerogative (its `source_id` axis); the
        // inverse reuses the same rows and can't renumber them without corrupting
        // the owner's order, so `order` is ignored there. One `CASE` update
        // renumbers every listed target instead of a statement per id.
        if (resolved.order?.length && join.ownCol === 'sourceId') {
            // Renumber the whole list in one UPDATE — position = its index in
            // `order`, via a CASE keyed on the ref id — instead of an UPDATE per
            // id inside the locked transaction. The WHERE bounds it to this
            // source's rows named in `order`; the `else` keeps any unmatched row
            // untouched.
            const order = resolved.order;
            const cases = order.map(
                (targetId, i) => sql`when ${ref} = ${targetId} then ${i}`
            );
            await tx
                .update(join.table)
                .set({
                    position: sql`case ${sql.join(cases, sql` `)} else ${cols['position']} end`
                } as never)
                .where(and(eq(own, sourceId), inArray(ref, order)));
        }
    }

    /**
     * Replace a many-relation's links with exactly `values[field]` (array),
     * position = array index — the **whole-set** write used only when a caller
     * genuinely submits a relation **array** in the entry body (legacy / bulk).
     * The editor uses {@link applyDelta} instead. Runs inside the entry's
     * transaction. **Only an array counts**: a field that's absent or `null`
     * (`coerceValues` stamps `null` onto every unset field) is left untouched, so
     * a save that manages a relation purely through deltas can never have its
     * links cleared here.
     */
    async writeLinks(
        tx: DbTransaction,
        type: AnyContentType,
        sourceId: string,
        values: Record<string, unknown>,
        workspaceId: string,
        sourceLocale?: string
    ): Promise<void> {
        for (const [name, spec] of Object.entries(type.fields)) {
            // Only a genuinely submitted **array** is a whole-set write. Anything
            // else — key absent, or `null` (which `coerceValues` stamps onto
            // every unset field) — means "not managing this relation via the
            // whole-set path"; skip it so the incremental delta path owns it and
            // a null can't be read as "clear all links".
            if (!Array.isArray(values[name])) continue;
            const join = this.joinPlanFor(type, name, spec);
            if (!join || join.ownCol !== 'sourceId') continue; // owning many only
            const ids = dedupe(values[name] as unknown[]);
            await this.assertTargets(
                tx,
                join.target,
                ids,
                workspaceId,
                name,
                sourceLocale
            );
            const cols = join.table as unknown as Columns;
            const own = cols[join.ownCol];
            const ref = cols[join.refCol];
            await tx
                .delete(join.table)
                .where(
                    ids.length
                        ? and(eq(own, sourceId), notInArray(ref, ids))
                        : eq(own, sourceId)
                );
            if (ids.length) {
                await tx
                    .insert(join.table)
                    .values(
                        ids.map(
                            (id, i) =>
                                ({
                                    [join.ownCol]: sourceId,
                                    [join.refCol]: id,
                                    position: i
                                }) as never
                        )
                    )
                    .onConflictDoNothing();
            }
        }
    }

    /**
     * Count the links of one join-backed relation field for an entry — the
     * `total` a read would report, without fetching or resolving any page. Runs
     * on the passed executor (the write transaction when validating a just-saved
     * entry, so it sees the delta's uncommitted rows). Returns 0 for a relation
     * that owns no writable links from this side (single FK / inverse-of-single).
     */
    async countLinks(
        exec: Database | DbTransaction,
        type: AnyContentType,
        row: Row,
        field: string,
        spec: AnyFieldSpec,
        workspaceId: string
    ): Promise<number> {
        const join = this.joinPlanFor(type, field, spec);
        if (join) {
            const cols = join.table as unknown as Columns;
            const [{ total }] = await exec
                .select({ total: count() })
                .from(join.table)
                .where(eq(cols[join.ownCol], row['id']));
            return Number(total);
        }
        const inverse = this.inversePlanFor(spec);
        if (inverse) {
            const cols = inverse.table as unknown as Columns;
            const [{ total }] = await exec
                .select({ total: count() })
                .from(inverse.table)
                .where(
                    and(
                        eq(cols[inverse.fkCol], row['id']),
                        eq(cols['workspaceId'], workspaceId),
                        cols['deletedAt']
                            ? isNull(cols['deletedAt'])
                            : undefined
                    )
                );
            return Number(total);
        }
        return 0;
    }

    // ---- helpers -----------------------------------------------------------

    /**
     * Take the transaction-scoped advisory lock for one physical source list
     * (`<join table>:<sourceId>`), serializing every appender to that list so no
     * two concurrent writes read the same `max(position)`. Auto-releases at
     * commit/rollback. Keyed on the table name too, so distinct join tables that
     * happen to share a source id don't falsely contend.
     */
    private async lockSource(
        tx: DbTransaction,
        table: PgTable,
        sourceId: string
    ): Promise<void> {
        const key = `${getTableName(table)}:${sourceId}`;
        await tx.execute(
            sql`select pg_advisory_xact_lock(${RELATION_APPEND_LOCK_CLASS}, hashtext(${key}))`
        );
    }

    /** Next append position for a source: `max(position) + 1`, else 0. */
    private async nextPosition(
        tx: DbTransaction,
        table: PgTable,
        sourceId: string
    ): Promise<number> {
        const cols = table as unknown as Columns;
        const [row] = await tx
            .select({ max: max(cols['position']) })
            .from(table)
            .where(eq(cols['sourceId'], sourceId));
        const current = row?.max;
        return current == null ? 0 : Number(current) + 1;
    }

    /**
     * Public resolver for callers that hold **raw ids** rather than a live link
     * set — the revision preview, which reads a historical snapshot's relation id
     * lists and needs their display titles. Resolves the first `cap` ids (order
     * preserved) via the same batched lookup as {@link refsFor}; the caller
     * carries the true count separately and shows a "+N more" past the cap, so a
     * relation with thousands of links is never resolved whole. A soft-deleted /
     * foreign id yields a `missing` ref, never a title leak.
     */
    async resolveRefs(
        target: AnyContentType,
        ids: readonly string[],
        workspaceId: string,
        cap: number
    ): Promise<RelationRef[]> {
        return this.refsFor(target, ids.slice(0, cap), workspaceId);
    }

    /**
     * Resolve `ids` (in order) to display-ready refs via one lookup on the target
     * type, scoped to the workspace. Ids with no **live** row drop to an id-only
     * ref — a soft-deleted (paranoid) target is excluded here just as it is on
     * the inverse read side, so a trashed record never surfaces its title on the
     * owning side while it's hidden on the other.
     */
    private async refsFor(
        target: AnyContentType,
        ids: string[],
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ): Promise<RelationRef[]> {
        if (!ids.length) return [];
        const cols = target.table as unknown as Columns;
        const rows = (await this.db
            .select()
            .from(target.table)
            .where(
                and(
                    inArray(cols['id'], [...new Set(ids)]),
                    this.targetVisibleWhere(target, workspaceId, visibility)
                )
            )) as Row[];
        const byId = new Map(
            rows.map((row) => [row['id'] as string, this.rowToRef(target, row)])
        );
        // A ref is produced for *every* id, so a link is never silently
        // dropped — `total` and `items` stay consistent. An id with no live row
        // is flagged `missing` rather than passed off as a titled record: its
        // `title` is only the raw id standing in, which the UI must not print.
        return ids.map(
            (id) => byId.get(id) ?? { id, title: id, missing: true as const }
        );
    }

    /**
     * The visibility predicate applied to a relation's target rows: the
     * workspace scope, the soft-delete guard, and — only when the caller asks
     * for it — the published-only restriction plus the bound read scopes.
     *
     * **One definition**, and that is the load-bearing part. Every path that
     * reads a target goes through it: the row read (`refsFor`), the windowed
     * link reads whose `count(*) over` must not over-report, and the sub-select
     * the join-table reads restrict their window by. So `items` and `total`
     * cannot disagree about what a visible target is — which is exactly what
     * they did while the read scopes were applied only when *hydrating* the
     * items: a reader denied three of five linked records saw two items under a
     * `total` of five, and could infer three restricted records existed.
     */
    private targetVisibleWhere(
        target: AnyContentType,
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ) {
        const cols = target.table as unknown as Columns;
        return and(
            eq(cols['workspaceId'], workspaceId),
            cols['deletedAt'] ? isNull(cols['deletedAt']) : undefined,
            visibility?.publishedOnly && target.publishable
                ? eq(cols['status'], ENTRY_STATUS.Published)
                : undefined,
            ...this.readScopeWhere(target, workspaceId, visibility)
        );
    }

    /**
     * The bound read scopes' fragments for a relation's **target** type, on a
     * public read.
     *
     * Asked about the target rather than the type the request named: a reader
     * allowed to see an article is not thereby allowed to see everything it
     * points at, and a scope keyed to the source would leave every target
     * unguarded.
     *
     * Gated on `publishedOnly`, which is the flag that marks a public read. The
     * admin's calls pass no visibility and are untouched — an editor must see
     * the records their entry links to in order to manage them, including ones
     * no reader may fetch.
     */
    private readScopeWhere(
        target: AnyContentType,
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ): (SQL | undefined)[] {
        if (!visibility?.publishedOnly) return [];
        return this.readScopes?.fragments({ type: target, workspaceId }) ?? [];
    }

    /**
     * The id sub-select of a target's visible rows — how a link read that reads
     * only the JOIN table (so has no target columns of its own) restricts to
     * visible targets *inside* its window, keeping `total` honest. `undefined`
     * when no extra restriction applies, so the predicate collapses away.
     */
    private visibleTargetIds(
        target: AnyContentType,
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ) {
        // `publishedOnly` is the public-read marker, so it also gates the read
        // scopes (see {@link targetVisibleWhere}) — one check covers both.
        if (!visibility?.publishedOnly) return undefined;
        const cols = target.table as unknown as SelectableColumns;
        return this.db
            .select({ id: cols['id'] })
            .from(target.table)
            .where(this.targetVisibleWhere(target, workspaceId, visibility));
    }

    /**
     * `ref IN (visible target ids)`, or `undefined` when no restriction
     * applies. Wraps {@link visibleTargetIds} for the join-table reads, whose
     * only handle on the target is the id column in the join row.
     */
    private visibleTargetIdsPredicate(
        refColumn: PgColumn,
        target: AnyContentType,
        workspaceId: string,
        visibility?: RelationTargetVisibility
    ) {
        const visible = this.visibleTargetIds(target, workspaceId, visibility);
        return visible ? inArray(refColumn, visible) : undefined;
    }

    /** Build a display ref from a full target row. */
    private rowToRef(target: AnyContentType, row: Row): RelationRef {
        const ref: RelationRef = {
            id: row['id'] as string,
            title: entryTitle(target, row)
        };
        const slug = entrySlug(target, row);
        if (slug) ref.slug = slug;
        if (target.publishable) ref.status = row['status'] as EntryStatus;
        return ref;
    }

    /**
     * Rewrite a delta's translation-group ids into entry ids, picking each
     * group's row in the **source entry's own locale**.
     *
     * This is the half of the cross-locale rule that makes it usable rather than
     * merely strict. A client that thinks in stories holds one group id per
     * story, not one entry id per language; without this it would have to keep a
     * per-locale id map and pick the right entry for every write — and picking
     * wrong is exactly what the rule then rejects. Here the server picks, and it
     * is the only party that knows the source row's locale for certain.
     *
     * A group with no row in this locale is a **422** naming the field: the
     * caller asked to link a story that has not been translated into this
     * language yet, which is a real content gap rather than a bad request.
     */
    async resolveLocaleGroups(
        runner: QueryRunner,
        target: AnyContentType,
        groupIds: string[],
        workspaceId: string,
        field: string,
        sourceLocale: string | undefined
    ): Promise<Map<string, string>> {
        if (!target.i18n || !sourceLocale) {
            throw new BadRequestException(
                `Relation "${field}" cannot be addressed by locale group — ` +
                    (target.i18n
                        ? 'this entry is not localized, so there is no locale to resolve into.'
                        : `"${target.name}" is not a localized content type.`)
            );
        }
        const unique = [...new Set(groupIds.filter(Boolean))];
        if (!unique.length) return new Map();

        const cols = target.table as unknown as Columns;
        const rows = (await runner
            .select()
            .from(target.table)
            .where(
                and(
                    inArray(cols['localeGroupId'], unique),
                    eq(cols['workspaceId'], workspaceId),
                    eq(cols['locale'], sourceLocale),
                    target.paranoid ? isNull(cols['deletedAt']) : undefined
                )
            )) as Row[];
        const byGroup = new Map(
            rows.map((row) => [
                row['localeGroupId'] as string,
                row['id'] as string
            ])
        );

        const missing = unique.filter((id) => !byGroup.has(id));
        if (missing.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues: missing.map((groupId) => ({
                    field,
                    message:
                        `no "${sourceLocale}" entry exists in translation group ` +
                        `"${groupId}" on "${target.name}" — translate that record ` +
                        'into this locale before linking it.'
                }))
            });
        }
        return byGroup;
    }

    /**
     * The **lenient** counterpart of {@link resolveLocaleGroups}: given target
     * ids held by one row, find the equivalent id in each of `locales` — the
     * row of the same translation group, in that language.
     *
     * Returns `locale → (given id → that locale's id)`. A pair with no row in a
     * locale is simply **absent** rather than an error, which is the whole
     * difference. `resolveLocaleGroups` answers an explicit API call naming a
     * group, where a missing translation is a request to reject; this answers
     * the implicit sibling sync, where it is a content gap on the *target* and
     * failing would mean an English save could not be saved until somebody
     * translated a tag.
     *
     * Two queries regardless of how many ids or locales are asked for: one to
     * read the given ids' groups, one to read those groups' rows in the wanted
     * locales. Soft-deleted rows are excluded from the **destination** side —
     * required for determinism, since the `(locale_group_id, locale)` unique
     * index is partial (`WHERE deleted_at IS NULL`) on a paranoid type, so
     * trashed rows can legitimately repeat a pair. The source lookup is not
     * filtered: a link to a trashed row still has a group, and dropping it
     * would silently unlink siblings whenever a target went to the bin.
     */
    async equivalentIdsByLocale(
        exec: QueryRunner,
        target: AnyContentType,
        ids: readonly string[],
        locales: readonly string[],
        workspaceId: string
    ): Promise<Map<string, Map<string, string>>> {
        const out = new Map<string, Map<string, string>>();
        for (const locale of locales) out.set(locale, new Map());
        const unique = [...new Set(ids)].filter(Boolean);
        if (!target.i18n || !unique.length || !locales.length) return out;

        const cols = target.table as unknown as Columns;
        const sourceRows = (await exec
            .select()
            .from(target.table)
            .where(
                and(
                    inArray(cols['id'], unique),
                    eq(cols['workspaceId'], workspaceId)
                )
            )) as Row[];
        const groupOf = new Map(
            sourceRows.map((row) => [
                row['id'] as string,
                row['localeGroupId'] as string
            ])
        );
        const groups = [...new Set(groupOf.values())].filter(Boolean);
        if (!groups.length) return out;

        const siblingRows = (await exec
            .select()
            .from(target.table)
            .where(
                and(
                    inArray(cols['localeGroupId'], groups),
                    inArray(cols['locale'], [...locales]),
                    eq(cols['workspaceId'], workspaceId),
                    target.paranoid ? isNull(cols['deletedAt']) : undefined
                )
            )) as Row[];
        // Keyed by group AND locale, since one group contributes at most one
        // row per language and the pair is what a sibling asks for.
        const byGroupLocale = new Map<string, string>();
        for (const row of siblingRows) {
            byGroupLocale.set(
                groupLocaleKey(
                    row['localeGroupId'] as string,
                    row['locale'] as string
                ),
                row['id'] as string
            );
        }

        for (const locale of locales) {
            const bucket = out.get(locale) as Map<string, string>;
            for (const id of unique) {
                const group = groupOf.get(id);
                if (!group) continue;
                const equivalent = byGroupLocale.get(
                    groupLocaleKey(group, locale)
                );
                if (equivalent) bucket.set(id, equivalent);
            }
        }
        return out;
    }

    /**
     * Replace one join-backed relation field's links for `sourceId` with
     * exactly `targetIds`, in order — the primitive the locale sibling sync
     * writes through. Returns whether anything actually changed, so a caller
     * can leave an already-correct sibling untouched (and unversioned).
     *
     * Deliberately **not** {@link applyDelta}: that is an incremental edit from
     * a client that knows what it changed, while a sync knows only the desired
     * end state. Deliberately not {@link writeLinks} either — that reads its ids
     * out of a values bag and re-validates targets the caller may not have.
     * Here the ids came from a sibling row that already passed those checks.
     */
    async replaceLinks(
        tx: DbTransaction,
        type: AnyContentType,
        sourceId: string,
        field: string,
        targetIds: readonly string[]
    ): Promise<boolean> {
        const spec = type.fields[field];
        const join = spec ? this.joinPlanFor(type, field, spec) : null;
        if (!join || join.ownCol !== 'sourceId') return false;

        const cols = join.table as unknown as Columns;
        const own = cols[join.ownCol];
        const ref = cols[join.refCol];
        const desired = dedupe([...targetIds]);

        // Compare before writing: an unchanged sibling must not be rewritten,
        // or every save would re-version the whole translation group.
        const currentRows = (await tx
            .select()
            .from(join.table)
            .where(eq(own, sourceId))
            .orderBy(asc(cols['position']), asc(ref))) as Row[];
        const current = currentRows.map((row) => row[join.refCol] as string);
        if (
            current.length === desired.length &&
            current.every((id, index) => id === desired[index])
        ) {
            return false;
        }

        await tx.delete(join.table).where(eq(own, sourceId));
        if (desired.length) {
            await tx.insert(join.table).values(
                desired.map(
                    (targetId, index) =>
                        ({
                            [join.ownCol]: sourceId,
                            [join.refCol]: targetId,
                            position: index
                        }) as never
                )
            );
        }
        return true;
    }

    /**
     * The ordered link ids of **one** join-backed relation field, read on the
     * passed executor. {@link snapshotLinks} reads every field at once for a
     * revision; the sync needs one field at a time, and only the ones that
     * actually propagate.
     */
    async linkIdsOf(
        exec: Database | DbTransaction,
        type: AnyContentType,
        sourceId: string,
        field: string
    ): Promise<string[]> {
        const spec = type.fields[field];
        const join = spec ? this.joinPlanFor(type, field, spec) : null;
        if (!join) return [];
        const cols = join.table as unknown as Columns;
        const rows = (await exec
            .select()
            .from(join.table)
            .where(eq(cols[join.ownCol], sourceId))
            .orderBy(asc(cols['position']), asc(cols[join.refCol]))) as Row[];
        return rows.map((row) => row[join.refCol] as string);
    }

    /** {@link resolveLocaleGroups} applied to a delta's three id arrays. */
    private async resolveByLocaleGroup(
        tx: DbTransaction,
        target: AnyContentType,
        delta: RelationDelta,
        workspaceId: string,
        field: string,
        sourceLocale: string | undefined
    ): Promise<RelationDelta> {
        const byGroup = await this.resolveLocaleGroups(
            tx,
            target,
            [
                ...(delta.link ?? []),
                ...(delta.unlink ?? []),
                ...(delta.order ?? [])
            ],
            workspaceId,
            field,
            sourceLocale
        );
        // `unlink` maps through the same table: a group that resolves to a row
        // which was never linked is simply a no-op delete, as it is by id.
        const map = (ids?: string[]) =>
            ids?.map((groupId) => byGroup.get(groupId) as string);
        return {
            ...(map(delta.link) ? { link: map(delta.link) } : {}),
            ...(map(delta.unlink) ? { unlink: map(delta.unlink) } : {}),
            ...(map(delta.order) ? { order: map(delta.order) } : {})
        };
    }

    /**
     * Verify every id to be linked exists **in the same workspace** (the join FK
     * has no workspace constraint of its own). A missing or cross-workspace id is
     * a uniform 422 — indistinguishable from an invalid id, so no enumeration
     * signal.
     *
     * When `sourceLocale` is given and the target type is localized, the link is
     * additionally required to stay **inside one locale**. Two i18n types linked
     * across locales is a broken model, not a preference: the English article
     * would render the German tag, and because join links are per-row rather
     * than synced across a translation group, nothing would ever repair it. The
     * admin has always enforced this in its picker (which offers same-locale
     * candidates only) — this is the same rule where it cannot be bypassed by
     * talking to the API directly.
     *
     * The caller passes the **source row's own** locale, so the rule reads off
     * the row being written rather than off a request parameter that may name a
     * different one. `undefined` (a non-i18n owner) disables the check.
     */
    private async assertTargets(
        tx: DbTransaction,
        target: AnyContentType,
        ids: string[],
        workspaceId: string,
        field: string,
        sourceLocale?: string
    ): Promise<void> {
        const unique = [...new Set(ids)].filter((id) => !!id);
        if (!unique.length) return;
        const cols = target.table as unknown as Columns;
        // Read on the write transaction's own connection (not `this.db`, a
        // separate pooled connection), so the existence check shares the txn's
        // snapshot and the workspace advisory lock the write path holds.
        const rows = (await tx
            .select()
            .from(target.table)
            .where(
                and(
                    inArray(cols['id'], unique),
                    eq(cols['workspaceId'], workspaceId)
                )
            )) as Row[];
        const present = new Set(rows.map((r) => r['id'] as string));
        const missing = unique.filter((id) => !present.has(id));
        if (missing.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues: missing.map(() => ({
                    field,
                    message: 'must reference an existing entry'
                }))
            });
        }
        assertSameLocale(rows, target, field, sourceLocale);
    }

    /**
     * The join-table plan for a relation field, or `null` when it owns no join
     * table (an owning single relation, or an inverse-of-single). An owning
     * many-relation uses its own join table (`source→target`); an inverse of a
     * many-to-many reuses the owning side's join table with the roles swapped.
     */
    private joinPlanFor(
        type: AnyContentType,
        field: string,
        spec: AnyFieldSpec
    ): JoinPlan | null {
        if (spec.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation)
            return null;
        const relation = spec.relation;
        if (relation.inverse) {
            const owner = relation.to();
            const owningField = owner.fields[relation.inverse.field];
            if (!owningField?.relation?.many) return null; // inverse-of-single
            return {
                table: owner.joinTables[relation.inverse.field],
                ownCol: 'targetId',
                refCol: 'sourceId',
                target: relation.to()
            };
        }
        if (relation.many) {
            return {
                table: type.joinTables[field],
                ownCol: 'sourceId',
                refCol: 'targetId',
                target: relation.to()
            };
        }
        return null;
    }

    /**
     * The inverse-of-single (one-to-many) plan for a relation field, or `null`:
     * it reads the owner rows whose FK points back at the editing record, and
     * owns no writable link from this side.
     */
    private inversePlanFor(spec: AnyFieldSpec): InversePlan | null {
        if (
            spec.type !== CONTENT_FIELD_TYPE.Relation ||
            !spec.relation?.inverse
        )
            return null;
        const owner = spec.relation.to();
        const owningField = owner.fields[spec.relation.inverse.field];
        if (owningField?.relation?.many) return null; // handled as a join plan
        return {
            table: owner.table,
            fkCol: spec.relation.inverse.field,
            target: owner
        };
    }
}

/**
 * The composite map key for "this translation group, in this locale".
 *
 * A named helper rather than an inline template so the two call sites cannot
 * drift apart on the separator — and so the separator is a visible character.
 * `|` cannot appear in either half: a `locale_group_id` is a uuid, and a locale
 * slug is `^[a-z]{2,3}(-[a-z0-9]+)*$`, so the pair is unambiguous.
 */
function groupLocaleKey(localeGroupId: string, locale: string): string {
    return `${localeGroupId}|${locale}`;
}

/** De-duplicate a list of ids, preserving order and dropping empties. */
function dedupe(value: unknown[] | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value ?? []) {
        if (typeof item === 'string' && item && !seen.has(item)) {
            seen.add(item);
            out.push(item);
        }
    }
    return out;
}
