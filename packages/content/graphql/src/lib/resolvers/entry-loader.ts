import {
    MAX_PAGE_SIZE,
    PREVIEW,
    type AnyContentType,
    type EntryVisibility,
    type PublicEntriesQuery,
    type PublicEntry,
    type PublicListEntriesQueryDto
} from '@orthacms/content-server';

/**
 * Re-reads entries **by id, with expansions**, batching every request made in
 * the same execution tick into one query per (type, locale, cap).
 *
 * ## Why this exists
 *
 * The REST expansion attaches one level: `?relations=preview` hands back linked
 * entries as full records, but *their* relations and media are absent — which is
 * exactly what stops one request walking the whole content graph. GraphQL
 * callers nest anyway, so something has to resolve level two and below, and the
 * naive version is an N+1: one query per linked entry per field.
 *
 * ## How it avoids that
 *
 * One primitive, used by every nested resolver: *load these ids of this type,
 * with these expansions*. Requests are collected across the tick, so all
 * siblings at a level coalesce — the cost is one query per level, not per row —
 * and the union of the fields they asked for is expanded in a single pass.
 *
 * ## Why it needs no new query code
 *
 * The batch is a plain `PublicEntriesQuery.list` with a `{ field: 'id', op:
 * 'in' }` filter. `id` is filterable on the public surface and `in` is a
 * supported operator, so the load runs through the **same** `readableWhere` as
 * every other public read: a draft, a soft-deleted row, or an entry from another
 * workspace is invisible here for the same reason and by the same code. A
 * bespoke `WHERE id IN (…)` would have been a second visibility rule to keep in
 * step, which is the one thing this design refuses to have.
 *
 * One cost worth naming: the batch does not narrow `?fields=`, so it reads every
 * value column of the parents even when the caller only wanted their relations.
 * Narrowing it would mean naming at least one value field, and there is no
 * spelling for "no values" (an empty `?fields=` means "no preference"). One
 * over-wide read per level beats one query per row, and the shallow case — where
 * a page's own columns dominate the cost — never reaches this class at all.
 */
export class EntryLoader {
    /** Batches keyed by type + locale + cap, awaiting dispatch. */
    private readonly pending = new Map<string, PendingBatch>();

    constructor(
        private readonly entries: PublicEntriesQuery,
        private readonly workspaceId: string
    ) {}

    /**
     * The entry `id` of `type`, re-read with the requested expansions. Joins any
     * batch already forming for the same type/locale/cap, or starts one.
     *
     * Returns `null` when the id is no longer publicly readable — the same
     * answer a direct read would give, rather than an error, because a link to a
     * since-unpublished entry is a normal state and not the caller's fault.
     */
    load(
        type: AnyContentType,
        id: string,
        request: ExpansionRequest,
        granted: ReadonlySet<string>
    ): Promise<PublicEntry | null> {
        const key = [
            type.name,
            request.locale ?? '',
            request.limit,
            request.translations ? 't' : '',
            request.status ?? ''
        ].join('|');
        let batch = this.pending.get(key);
        if (!batch) {
            // Dispatch once the current microtask queue has drained, so every
            // sibling resolver at this level has had its turn to enqueue. The
            // `Promise.resolve().then(...)` before `nextTick` is what puts this
            // *after* the resolver promises rather than between them. The
            // batch is fully built before it goes in the map, so a later joiner
            // always finds a `result` to await.
            const pending: Partial<PendingBatch> = {
                ids: new Set(),
                relationFields: new Set(),
                mediaFields: new Set(),
                translations: false
            };
            pending.result = Promise.resolve()
                .then(() => new Promise(process.nextTick))
                .then(() => this.dispatch(key, type, request, granted));
            batch = pending as PendingBatch;
            this.pending.set(key, batch);
        }
        batch.ids.add(id);
        for (const field of request.relationFields ?? []) {
            batch.relationFields.add(field);
        }
        for (const field of request.mediaFields ?? []) {
            batch.mediaFields.add(field);
        }
        batch.translations ||= request.translations === true;

        return batch.result.then((byId) => byId.get(id) ?? null);
    }

    /** Runs one accumulated batch and indexes its rows by id. */
    private async dispatch(
        key: string,
        type: AnyContentType,
        request: ExpansionRequest,
        granted: ReadonlySet<string>
    ): Promise<Map<string, PublicEntry>> {
        const batch = this.pending.get(key);
        this.pending.delete(key);
        if (!batch) {
            return new Map();
        }
        const ids = [...batch.ids];
        const byId = new Map<string, PublicEntry>();
        // `pageSize` is capped, so a level wider than the cap becomes several
        // queries rather than one silently truncated page.
        for (let i = 0; i < ids.length; i += MAX_PAGE_SIZE) {
            const chunk = ids.slice(i, i + MAX_PAGE_SIZE);
            const dto = {
                page: 1,
                pageSize: chunk.length,
                filter: JSON.stringify({
                    and: [{ field: 'id', op: 'in', value: chunk }]
                })
            } as PublicListEntriesQueryDto;
            if (request.locale) {
                dto.locale = request.locale;
            }
            if (request.status) {
                dto.status = request.status;
            }
            if (batch.relationFields.size > 0) {
                dto.relations = PREVIEW;
                dto.relationFields = [...batch.relationFields].join(',');
                dto.relationLimit = request.limit;
            }
            if (batch.mediaFields.size > 0) {
                dto.media = PREVIEW;
                dto.mediaFields = [...batch.mediaFields].join(',');
                dto.mediaLimit = request.limit;
            }
            if (batch.translations) {
                dto.translations = PREVIEW;
            }
            const page = await this.entries.list(
                type,
                dto,
                this.workspaceId,
                granted
            );
            for (const entry of page.items) {
                byId.set(entry.id, entry);
            }
        }
        return byId;
    }
}

/** What one nested resolver wants attached to the entries it is loading. */
export interface ExpansionRequest {
    /** Relation fields to expand on the loaded entries. */
    relationFields?: readonly string[];
    /** Media fields to expand. */
    mediaFields?: readonly string[];
    /** Attach the entries' sibling translations. */
    translations?: boolean;
    /** Items per expanded field. */
    limit: number;
    /** Locale to read in — the requesting entry's own, on a localized type. */
    locale?: string;
    /**
     * Publish states the re-read may return. Absent means `published`, which is
     * right for a linked target and **wrong for the parent the caller already
     * holds**: a mutation returns a draft, and re-reading it through the
     * published-only rule finds nothing, so every relation, media field and
     * `translations` selection on a freshly-created entry came back empty.
     *
     * Widened only when the entry in hand is itself a draft, which the caller
     * could not be holding unless they were already authorized for drafts —
     * `assertVisibility` gates `status: DRAFT|ANY` on reads, and a mutation
     * result required the write permission it asserted. So this never shows a
     * row `readableWhere` would have hidden; it asks the same question with the
     * visibility the caller already had.
     */
    status?: EntryVisibility;
}

/** A batch accumulating requests until the tick ends. */
interface PendingBatch {
    ids: Set<string>;
    relationFields: Set<string>;
    mediaFields: Set<string>;
    translations: boolean;
    /** Resolves to every loaded entry of this batch, keyed by id. */
    result: Promise<Map<string, PublicEntry>>;
}
