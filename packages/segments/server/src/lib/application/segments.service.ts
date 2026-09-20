import {
    ConflictException,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
    attachActor,
    InjectDatabase,
    OutboxWriter,
    UnitOfWork,
    type Database,
    type DomainEvent,
    type EventActor
} from '@ortha/database';
import { segments } from '../schema/segments';
import { entryAccess } from '../schema/entry-access';
import { SegmentCatalogService } from './segment-catalog.service';
import { SEGMENT_EVENT_KINDS, segmentEvent } from '../segments.events';

/** One segment as the admin sees it. */
export interface SegmentView {
    id: string;
    key: string;
    label: string;
    tags: string[];
    /** The workspaces it is offered in. **Empty means every one.** */
    workspaceIds: string[];
    /** How many entries name it, either way — "is this one actually used?". */
    usageCount: number;
}

/** One page of the directory. */
export interface SegmentListView {
    items: SegmentView[];
    total: number;
    page: number;
    pageSize: number;
    /**
     * Every id the filter matched, not only this page's — what the entry
     * editor's "set every audience to…" acts on, so a bulk action means the
     * whole list rather than whichever ten rows happen to be on screen.
     *
     * Capped at {@link MATCHED_IDS_CAP}, which is deliberately the same number
     * an entry may store on one side: past it the bulk action could not be
     * carried out anyway, and {@link SegmentListView.idsTruncated} is how the
     * editor knows to say so instead of silently doing part of it.
     */
    ids: string[];
    /** Whether {@link SegmentListView.ids} was cut short by the cap. */
    idsTruncated: boolean;
}

/** Longest accepted search term, so a needle cannot be a payload. */
const QUERY_MAX = 200;

/** Rows per page when the caller does not say. */
export const DEFAULT_PAGE_SIZE = 25;
/** Most rows one page may carry. */
export const MAX_PAGE_SIZE = 100;
/**
 * Most matched ids returned alongside a page.
 *
 * The same number as the entry-access DTO's per-side cap, on purpose: these ids
 * exist to be written onto one entry, and offering more than could be stored
 * would be offering an action that 400s.
 */
export const MATCHED_IDS_CAP = 200;

/** How the directory is narrowed. */
export interface ListSegmentsParams {
    /** Case-insensitive substring over the label and the key. */
    query?: string;
    /**
     * Only audiences offered in this workspace — those naming it, plus those
     * naming none at all (which are offered everywhere). Omitted lists the
     * installation's whole vocabulary, which is what the directory shows.
     */
    workspaceId?: string;
    /** 1-based. */
    page?: number;
    pageSize?: number;
}

/**
 * The segment directory — create, rename, retag, rescope, delete.
 *
 * Every write reloads the catalogue, because the read path holds it in memory
 * and a rename that does not reach it is a rename nobody sees. A full reload of
 * a list this size is cheaper than any narrower scheme would be to get right.
 */
@Injectable()
export class SegmentsService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly catalog: SegmentCatalogService
    ) {}

    /**
     * One page of the directory, with usage counts.
     *
     * The `ids` alongside it are every match, not this page's — see
     * {@link SegmentListView.ids}. It costs one extra indexed read of a uuid
     * column, and it is what lets the entry editor offer "set them all" without
     * that meaning "set the ten you can currently see".
     */
    async list(params: ListSegmentsParams = {}): Promise<SegmentListView> {
        const page = Math.max(1, Math.trunc(params.page ?? 1));
        const pageSize = Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE))
        );
        const where = this.filter(params);

        const [total, rows, matched] = await Promise.all([
            this.db
                .select({ value: count() })
                .from(segments)
                .where(where)
                .then(([row]) => Number(row?.value ?? 0)),
            this.db
                .select()
                .from(segments)
                .where(where)
                .orderBy(asc(segments.label))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db
                .select({ id: segments.id })
                .from(segments)
                .where(where)
                .orderBy(asc(segments.label))
                .limit(MATCHED_IDS_CAP + 1)
        ]);

        const usage = await this.usageCounts();
        return {
            items: rows.map((row) => ({
                ...toView(row),
                usageCount: usage.get(row.id) ?? 0
            })),
            total,
            page,
            pageSize,
            ids: matched.slice(0, MATCHED_IDS_CAP).map((row) => row.id),
            idsTruncated: matched.length > MATCHED_IDS_CAP
        };
    }

    /**
     * Named segments, whatever page they would fall on.
     *
     * The directory is paginated, so a component that holds **ids** — the entry
     * header chip, a revision's captured access — can no longer count on the
     * first page containing the rows it has to name. Without this it would print
     * a uuid, or worse, "deleted audience" for one that is merely on page three.
     *
     * Unknown ids are skipped rather than refused: a segment really can have been
     * deleted since a revision captured it, and that is a state the caller
     * renders, not an error.
     */
    async byIds(ids: readonly string[]): Promise<SegmentView[]> {
        const unique = [...new Set(ids)].slice(0, MATCHED_IDS_CAP);
        if (!unique.length) return [];
        const rows = await this.db
            .select()
            .from(segments)
            .where(inArray(segments.id, unique))
            .orderBy(asc(segments.label));
        const usage = await this.usageCounts();
        return rows.map((row) => ({
            ...toView(row),
            usageCount: usage.get(row.id) ?? 0
        }));
    }

    /** One segment, or a 404 — what the editor page loads. */
    async get(id: string): Promise<SegmentView> {
        const row = await this.byId(id);
        const usage = await this.usageCounts();
        return { ...toView(row), usageCount: usage.get(row.id) ?? 0 };
    }

    /**
     * Append one segment event to the outbox from inside the active unit of
     * work, stamped with the acting administrator when there is one.
     */
    private async emit(event: DomainEvent, actor?: EventActor): Promise<void> {
        await this.outbox.append(actor ? attachActor([event], actor) : [event]);
    }

    /** Create a segment. */
    async create(input: {
        key: string;
        label: string;
        tags?: readonly string[];
        workspaceIds?: readonly string[];
        actor?: EventActor;
    }): Promise<SegmentView> {
        const [existing] = await this.db
            .select({ id: segments.id })
            .from(segments)
            .where(eq(segments.key, input.key))
            .limit(1);
        if (existing) {
            throw new ConflictException(
                `A segment with the key "${input.key}" already exists.`
            );
        }

        // A segment with no tags matches nobody, which is a segment that can
        // only ever close content. Defaulting to the key is what the
        // administrator meant in every case but the one where they say
        // otherwise. Workspaces get no such default — empty already means
        // "every one", which is the right starting point.
        const row = await this.uow.run(async () => {
            const [created] = await this.uow
                .current()
                .insert(segments)
                .values({
                    key: input.key,
                    label: input.label,
                    tags: input.tags?.length ? [...input.tags] : [input.key],
                    workspaceIds: dedupe(input.workspaceIds)
                })
                .returning();
            await this.emit(
                segmentEvent(SEGMENT_EVENT_KINDS.CREATED, created.id, {
                    key: created.key,
                    label: created.label,
                    tags: created.tags,
                    workspaceIds: created.workspaceIds
                }),
                input.actor
            );
            return created;
        });
        await this.catalog.reload();
        return { ...toView(row), usageCount: 0 };
    }

    /**
     * Rename a segment, change the tags it answers to, or change where it is
     * offered.
     *
     * Changing `tags` is the operation the indirection exists for: an
     * identifier renamed upstream is one row edited here, and every entry that
     * named the segment keeps working, because none of them ever named a tag.
     *
     * Changing `workspaceIds` does **not** retract the segment from entries in a
     * workspace it no longer covers. Narrowing the scope stops it being offered
     * on new decisions; the decisions already made stay as their editors left
     * them, and are visible on those entries. Silently rewriting stored access
     * from a screen about a segment's availability is the sort of action nobody
     * connects to what they did.
     */
    async update(
        id: string,
        input: {
            label?: string;
            tags?: readonly string[];
            workspaceIds?: readonly string[];
            actor?: EventActor;
        }
    ): Promise<SegmentView> {
        const current = await this.byId(id);
        const row = await this.uow.run(async () => {
            const [updated] = await this.uow
                .current()
                .update(segments)
                .set({
                    label: input.label ?? current.label,
                    tags: input.tags ? [...input.tags] : current.tags,
                    workspaceIds: input.workspaceIds
                        ? dedupe(input.workspaceIds)
                        : current.workspaceIds,
                    updatedAt: new Date()
                })
                .where(eq(segments.id, id))
                .returning();
            // Both sides of the tag list, because this is the change that keeps
            // an audience's name and its entries while replacing the readers it
            // resolves to — invisible from anywhere else afterwards.
            await this.emit(
                segmentEvent(SEGMENT_EVENT_KINDS.UPDATED, id, {
                    key: updated.key,
                    label: updated.label,
                    tags: { from: current.tags, to: updated.tags },
                    workspaceIds: {
                        from: current.workspaceIds,
                        to: updated.workspaceIds
                    }
                }),
                input.actor
            );
            return updated;
        });
        await this.catalog.reload();
        const usage = await this.usageCounts();
        return { ...toView(row), usageCount: usage.get(row.id) ?? 0 };
    }

    /**
     * Delete a segment, and remove it from every entry that named it.
     *
     * The two halves are one transaction on purpose. Leaving the id behind
     * would leave entries pointing at a segment that resolves to nobody — which
     * on the allow side silently closes content and on the deny side silently
     * opens it, both without anything on screen to say why.
     *
     * An entry left with two empty lists loses its row entirely, which is the
     * same "no row means open" the writer maintains.
     */
    async remove(id: string, actor?: EventActor): Promise<void> {
        const current = await this.byId(id);
        await this.uow.run(async () => {
            const tx = this.uow.current();
            await tx.delete(segments).where(eq(segments.id, id));
            await tx
                .update(entryAccess)
                .set({
                    allow: sql`array_remove(${entryAccess.allow}, ${id}::uuid)`,
                    deny: sql`array_remove(${entryAccess.deny}, ${id}::uuid)`,
                    updatedAt: new Date()
                })
                .where(
                    sql`${entryAccess.allow} @> ARRAY[${id}::uuid] OR ${entryAccess.deny} @> ARRAY[${id}::uuid]`
                );
            await tx
                .delete(entryAccess)
                .where(
                    sql`cardinality(${entryAccess.allow}) = 0 AND cardinality(${entryAccess.deny}) = 0`
                );
            // The audience's own details are recorded here because after this
            // commits there is nowhere left to look them up — and the entries
            // that named it lost the mention without any screen saying so.
            await this.emit(
                segmentEvent(SEGMENT_EVENT_KINDS.DELETED, id, {
                    key: current.key,
                    label: current.label,
                    tags: current.tags,
                    workspaceIds: current.workspaceIds
                }),
                actor
            );
        });
        await this.catalog.reload();
    }

    /** The search + workspace narrowing, shared by the page, count and ids reads. */
    private filter(params: ListSegmentsParams) {
        const needle = params.query?.trim();
        const search = needle
            ? or(
                  ilike(segments.label, `%${escapeLike(needle)}%`),
                  ilike(segments.key, `%${escapeLike(needle)}%`)
              )
            : undefined;
        // "Offered here" is "names this workspace, or names none" — an unscoped
        // segment is offered everywhere, which is what every row starts as.
        const scope = params.workspaceId
            ? sql`(cardinality(${segments.workspaceIds}) = 0 OR ${segments.workspaceIds} @> ARRAY[${params.workspaceId}::uuid])`
            : undefined;
        if (search && scope) return and(search, scope);
        return search ?? scope;
    }

    /**
     * How many entries name each segment.
     *
     * One grouped query over both columns rather than a count per segment: the
     * directory asks about every segment at once, and a query per row is the
     * N+1 that makes the page slow exactly when a business has enough customers
     * to need the feature.
     */
    private async usageCounts(): Promise<Map<string, number>> {
        const result = (await this.db.execute(
            sql`SELECT segment_id::text AS id, count(DISTINCT entry_id)::int AS count
                FROM ${entryAccess},
                     LATERAL unnest(${entryAccess.allow} || ${entryAccess.deny}) AS segment_id
                GROUP BY segment_id`
        )) as unknown as { rows?: { id: string; count: number }[] };
        const list =
            result.rows ??
            (result as unknown as { id: string; count: number }[]);
        return new Map(list.map((row) => [row.id, Number(row.count)]));
    }

    /** One segment, or a 404. */
    private async byId(id: string) {
        const [row] = await this.db
            .select()
            .from(segments)
            .where(eq(segments.id, id))
            .limit(1);
        if (!row) throw new NotFoundException('Unknown segment.');
        return row;
    }
}

/** Row → wire shape, without the usage count. */
function toView(
    row: typeof segments.$inferSelect
): Omit<SegmentView, 'usageCount'> {
    return {
        id: row.id,
        key: row.key,
        label: row.label,
        tags: row.tags ?? [],
        workspaceIds: row.workspaceIds ?? []
    };
}

/** Unique ids, in the order given. */
function dedupe(ids: readonly string[] | undefined): string[] {
    return ids ? [...new Set(ids)] : [];
}

/** Escape the ILIKE metacharacters so a search term is read literally. */
function escapeLike(value: string): string {
    return value.slice(0, QUERY_MAX).replace(/[\\%_]/g, (char) => `\\${char}`);
}
