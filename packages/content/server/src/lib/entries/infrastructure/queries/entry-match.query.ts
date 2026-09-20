import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, count, eq, inArray, isNull, type AnyColumn } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import { applyFilterTree, parseFilterTree } from '@orthacms/utils-server';
import {
    CONTENT_ENTRY_EXTENSION,
    type ContentEntryExtension
} from '../../../extension/entry-extension';
import { EntryFilterProviderRegistry } from '../../../extension/entry-filter-provider';
import type { AnyContentType } from '../../../types/content-type';
import { buildEntryFilterSurface } from './entry-filter-surface';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * The same bag typed as `PgColumn` rather than `AnyColumn` — mirroring
 * `relation-link.service.ts`, because `SelectedFieldsFlat` accepts the narrower
 * type and not the broader one.
 */
type SelectableColumns = Record<string, PgColumn>;

/** Options narrowing a {@link EntryMatchQuery.matchingIds} scan. */
export interface EntryMatchOptions {
    /**
     * Restrict the scan to these entry ids. This is what turns a
     * collection-wide predicate into the point check an event-driven caller
     * needs — "does *this* row match?" is the same SQL with an extra
     * `id IN (...)`, so one code path serves both and they cannot disagree
     * about what a filter means.
     */
    entryIds?: readonly string[];
    /** Upper bound on returned ids. */
    limit?: number;
    /** Rows to skip — for batching a full-collection scan. */
    offset?: number;
}

/**
 * Answers "which entries of this type match this filter?" against the same
 * surface, parser and translator the records list uses.
 *
 * It exists so a downstream plugin can reuse content's filter semantics
 * without reaching for the database or rebuilding the surface: the filterable
 * paths, the relation-hop budget, the workspace scoping of every relation
 * subquery, and the 400 on a malformed tree are all inherited rather than
 * re-implemented. `@orthacms/alarms-server` evaluates its rules through this,
 * which is what makes "the rule I saved from the list means what the list
 * showed me" true by construction rather than by review.
 *
 * Two deliberate differences from the list query:
 *
 * - **No locale scoping.** The entries extension's `listScope` narrows a list
 *   to the active locale; a rule is a statement about the collection, so it
 *   must see every translation. The extension's *virtual filter fields* are
 *   still wired, so a rule may filter on them explicitly.
 * - **Trashed rows are excluded, always.** There is no trash view here, and a
 *   tombstoned row is not something anyone can act on.
 */
@Injectable()
export class EntryMatchQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        // Same pair as `EntriesService`: an alarm rule stores the records
        // list's filter verbatim, so it has to parse against exactly the
        // surface that list offers — including the fields other plugins add.
        private readonly filterProviders: EntryFilterProviderRegistry,
        @Optional()
        @Inject(CONTENT_ENTRY_EXTENSION)
        private readonly extension?: ContentEntryExtension
    ) {}

    /**
     * Parses `filter` against `type`'s surface without running it, throwing a
     * `FilterException` when it does not hold up. Callers store filters that
     * will be replayed by a background subscriber for months, so the parse
     * belongs at the moment the filter is written — a tree that only fails at
     * evaluation time fails somewhere nobody is looking.
     */
    assertParses(
        type: AnyContentType,
        filter: unknown,
        workspaceId: string
    ): void {
        const { schema } = buildEntryFilterSurface(type, {
            workspaceId,
            extensionFields: this.filterProviders.compose(
                type,
                this.extension?.filterExtension(type)
            )?.fields
        });
        parseFilterTree(filter, schema);
    }

    /**
     * Ids of `type` in `workspaceId` matching `filter`, oldest-id first so a
     * batched scan is stable across calls.
     */
    async matchingIds(
        type: AnyContentType,
        filter: unknown,
        workspaceId: string,
        options: EntryMatchOptions = {}
    ): Promise<string[]> {
        // An empty restriction means "none of them", not "all of them" — an
        // `inArray(col, [])` would be a false predicate anyway, but returning
        // early keeps a caller that batched its ids from paying for a query
        // whose answer is known.
        if (options.entryIds && options.entryIds.length === 0) return [];

        const where = await this.predicate(type, filter, workspaceId, options);
        const table = type.table as unknown as SelectableColumns;
        const rows = await this.db
            .select({ id: table['id'] })
            .from(type.table)
            .where(where)
            .orderBy(table['id'])
            .limit(options.limit ?? Number.MAX_SAFE_INTEGER)
            .offset(options.offset ?? 0);
        return rows.map((row) => String(row.id));
    }

    /** How many entries of `type` match `filter` right now. */
    async countMatching(
        type: AnyContentType,
        filter: unknown,
        workspaceId: string
    ): Promise<number> {
        const where = await this.predicate(type, filter, workspaceId, {});
        const [row] = await this.db
            .select({ total: count() })
            .from(type.table)
            .where(where);
        return Number(row?.total ?? 0);
    }

    /**
     * How many entries of `type` the workspace holds at all — the denominator
     * the rule editor shows beside a match count ("14 of 312"), which is what
     * turns a number into a judgement about whether the rule is too broad.
     */
    async countAll(type: AnyContentType, workspaceId: string): Promise<number> {
        const [row] = await this.db
            .select({ total: count() })
            .from(type.table)
            .where(this.scope(type, workspaceId));
        return Number(row?.total ?? 0);
    }

    /**
     * The workspace an entry belongs to, or `null` when no such row exists.
     *
     * A domain event names an entry and its content type but not its workspace
     * — every content table carries its own `workspace_id`, so there is nothing
     * for the envelope to add that a one-column lookup cannot answer. Exposed
     * here rather than left to each subscriber, so a downstream plugin never
     * has a reason to query a `content_<name>` table directly.
     */
    async workspaceOf(
        type: AnyContentType,
        entryId: string
    ): Promise<string | null> {
        const table = type.table as unknown as SelectableColumns;
        const [row] = await this.db
            .select({ workspaceId: table['workspaceId'] })
            .from(type.table)
            .where(eq(table['id'], entryId))
            .limit(1);
        return row?.workspaceId ? String(row.workspaceId) : null;
    }

    /** The workspace + not-trashed guard every scan starts from. */
    private scope(type: AnyContentType, workspaceId: string) {
        const table = type.table as unknown as ContentTable;
        return and(
            eq(table['workspaceId'], workspaceId),
            type.paranoid ? isNull(table['deletedAt']) : undefined
        );
    }

    /** Scope + translated filter + optional id restriction. */
    private async predicate(
        type: AnyContentType,
        filter: unknown,
        workspaceId: string,
        options: EntryMatchOptions
    ) {
        const filterExtension = this.filterProviders.compose(
            type,
            this.extension?.filterExtension(type)
        );
        const { schema } = buildEntryFilterSurface(type, {
            workspaceId,
            extensionFields: filterExtension?.fields
        });
        const tree = parseFilterTree(filter, schema);
        const filterSql = await applyFilterTree(
            tree,
            schema,
            type.table,
            this.db,
            filterExtension
                ? {
                      resolveExtension: (rule) =>
                          filterExtension.resolve(rule, { type, workspaceId })
                  }
                : {}
        );
        const table = type.table as unknown as ContentTable;
        return and(
            this.scope(type, workspaceId),
            filterSql,
            options.entryIds
                ? inArray(table['id'], [...options.entryIds])
                : undefined
        );
    }
}
