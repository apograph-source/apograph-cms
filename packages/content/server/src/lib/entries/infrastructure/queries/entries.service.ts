import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    and,
    asc,
    count,
    desc,
    eq,
    isNotNull,
    isNull,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { applyFilterTree, parseFilterTree } from '@orthacms/utils-server';
import {
    CONTENT_ENTRY_EXTENSION,
    type ContentEntryExtension,
    type EntryFilterExtension
} from '../../../extension/entry-extension';
import { EntryFilterProviderRegistry } from '../../../extension/entry-filter-provider';
import type { AnyContentType } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE } from '../../../types/fields';
import {
    DELETED_ONLY,
    RELATIONS_PREVIEW,
    type ListEntriesQueryDto
} from '../../http/dto/list-entries-query.dto';
import type { EntryListView } from '../../types/entry-list-view';
import { DEFAULT_PAGE_SIZE } from '../../entries.constants';
import { isScalarField } from './entry-scalar-fields';
import { buildEntryFilterSurface } from './entry-filter-surface';
import { buildSearchPredicate } from './entry-search';
import { toRecord } from '../persistence/entry-row';
import { RelationLinkService } from '../persistence/relation-link.service';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * The relation fields a `?relationFields=` list actually names, intersected with
 * the type's own relation fields. Unknown names are dropped, so a client string
 * never reaches a query — only keys already present on `type.fields` survive.
 */
function previewFields(
    type: AnyContentType,
    raw: string | undefined
): string[] {
    if (!raw) return [];
    const wanted = new Set(
        raw
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
    );
    return Object.entries(type.fields)
        .filter(
            ([name, spec]) =>
                wanted.has(name) &&
                spec.type === CONTENT_FIELD_TYPE.Relation &&
                !!spec.relation
        )
        .map(([name]) => name);
}

/**
 * Reads a collection's entries. Generic over the content type: the physical
 * table, the filterable columns, the searchable columns, and the sort whitelist
 * are all derived from `type` at request time, so one service backs every
 * collection. Owns no schema of its own — it queries the HOST-owned generated
 * `content_<name>` tables through the shared Drizzle client.
 */
@Injectable()
export class EntriesService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly relationLinks: RelationLinkService,
        // Virtual filter fields contributed by plugins other than the single
        // bound extension — segments' audience fields today. A registry rather
        // than a token, for the reason its own file documents.
        private readonly filterProviders: EntryFilterProviderRegistry,
        // The entries extension port (e.g. the i18n plugin's locale scoping) —
        // absent unless a downstream plugin binds it, hence optional.
        @Optional()
        @Inject(CONTENT_ENTRY_EXTENSION)
        private readonly extension?: ContentEntryExtension
    ) {}

    /**
     * One page of a collection's entries: search → filter → sort → paginate, run
     * in SQL against the type's generated table, returned as the
     * `{ items, total, page, pageSize }` envelope the admin records table renders.
     * Scoped to `workspaceId` — only the calling workspace's entries are counted
     * or listed.
     */
    async list(
        type: AnyContentType,
        query: ListEntriesQueryDto,
        workspaceId: string
    ): Promise<EntryListView> {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

        const where = await this.listWhere(type, query, workspaceId);
        const orderBy = this.orderBy(type, query.sort);

        // Count and page rows share the WHERE but are independent — run them
        // concurrently so the request pays the slower of the two, not their sum.
        const [[{ total }], rows] = await Promise.all([
            this.db.select({ total: count() }).from(type.table).where(where),
            this.db
                .select()
                .from(type.table)
                .where(where)
                .orderBy(...orderBy)
                .limit(pageSize)
                .offset((page - 1) * pageSize)
        ]);

        const items = rows.map((row) =>
            toRecord(type, row as Record<string, unknown>)
        );

        // Opt-in relation preview for the records table's visible relation
        // columns. Batched across the whole page (a constant number of queries
        // per field), so this never becomes an N+1 over rows — see
        // `previewForEntries`. Off by default: the relation picker reuses this
        // endpoint for candidates and must not pay for it.
        if (query.relations === RELATIONS_PREVIEW && items.length) {
            const fields = previewFields(type, query.relationFields);
            if (fields.length) {
                const previews = await this.relationLinks.previewForEntries(
                    type,
                    fields,
                    rows as Record<string, unknown>[],
                    workspaceId
                );
                for (const item of items) {
                    const preview = previews.get(item.id);
                    if (preview) item.relations = preview;
                }
            }
        }

        return { items, total, page, pageSize };
    }

    /**
     * The full WHERE: the workspace scope AND free-text search AND the
     * query-builder `?filter=` tree AND (for paranoid types) the not-deleted
     * guard. `and(undefined, …)` collapses empties, so an unfiltered list still
     * scans the workspace's whole table. The workspace predicate is always
     * present, so an entry never leaks across workspaces. A malformed filter
     * throws a `FilterException` (HTTP 400).
     */
    private async listWhere(
        type: AnyContentType,
        query: ListEntriesQueryDto,
        workspaceId: string
    ): Promise<SQL | undefined> {
        // The bound extension may contribute virtual filter fields (declared
        // into the schema, resolved to its own SQL) and an extra scope
        // predicate (e.g. the active locale). Both are no-ops for types the
        // extension doesn't apply to.
        // The bound extension (i18n) plus every registered provider (segments'
        // audience fields), folded into one contribution — see
        // `EntryFilterProviderRegistry`, which exists because that port is a
        // single binding and a second plugin would otherwise replace it.
        const filterExtension = this.filterProviders.compose(
            type,
            this.extension?.filterExtension(type)
        );
        // Building the surface walks the type's whole relation graph to the
        // hop budget, so only pay for it when there is actually a filter to
        // translate — an unfiltered list (the common case) skips it entirely.
        //
        // `grantedTypes` is deliberately left unset: this is the SQL
        // whitelist, not a visibility boundary, and pruning it by grant would
        // make the *same* saved filter 400 or silently change meaning
        // depending on which workspace opened it. Grant pruning belongs on
        // the `/filter-fields` surface the picker renders, where it is
        // applied. Every relation subquery is workspace-scoped regardless, so
        // a traversal can never read another workspace's rows.
        const filterSql = query.filter
            ? await this.filterPredicate(
                  type,
                  query.filter,
                  workspaceId,
                  filterExtension
              )
            : undefined;
        const table = type.table as unknown as ContentTable;
        return and(
            eq(table['workspaceId'], workspaceId),
            this.extension?.listScope(type, workspaceId, {
                locale: query.locale,
                localeFallback: query.localeFallback
            }),
            buildSearchPredicate(type, query.search),
            filterSql,
            this.deletedPredicate(type, query)
        );
    }

    /**
     * Translate one `?filter=` payload against the type's filterable surface.
     * The surface is built per request (content types are code-defined, so it
     * is pure derivation) and produces BOTH the SQL whitelist used here and
     * the wire list `/filter-fields` serves — one traversal, so the picker can
     * never offer a path this rejects. A malformed filter throws a
     * `FilterException` (HTTP 400).
     */
    private async filterPredicate(
        type: AnyContentType,
        filter: string,
        workspaceId: string,
        filterExtension: EntryFilterExtension | undefined
    ): Promise<SQL | undefined> {
        const { schema } = buildEntryFilterSurface(type, {
            workspaceId,
            extensionFields: filterExtension?.fields
        });
        const tree = parseFilterTree(filter, schema);
        return applyFilterTree(
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
    }

    /**
     * The soft-delete guard for paranoid types: the default list excludes
     * tombstoned rows (`deleted_at IS NULL`); `?deleted=only` flips to the trash
     * view (`deleted_at IS NOT NULL`). A non-paranoid type has no `deleted_at`,
     * so the predicate collapses to `undefined`.
     */
    private deletedPredicate(
        type: AnyContentType,
        query: ListEntriesQueryDto
    ): SQL | undefined {
        if (!type.paranoid) return undefined;
        const table = type.table as unknown as ContentTable;
        return query.deleted === DELETED_ONLY
            ? isNotNull(table['deletedAt'])
            : isNull(table['deletedAt']);
    }

    /**
     * Translate the `?sort=` spec (`col` asc, `-col` desc) into an ORDER BY,
     * always with an `id` tiebreaker so pagination is stable across requests.
     * Sortable = the always-present envelope columns + `status` (publishable
     * only) + the type's **scalar** fields. Non-scalar fields (`json`/
     * `multiselect`, single/many `relation`) are excluded — a many-relation has
     * no column on the main table at all, so ordering by it would pass
     * `undefined` to `asc`/`desc`; the others have no meaningful order. An
     * unknown or excluded column falls back to `updatedAt` desc.
     */
    private orderBy(type: AnyContentType, sort: string | undefined): SQL[] {
        const table = type.table as unknown as ContentTable;
        const sortable = new Set<string>([
            'createdAt',
            'updatedAt',
            ...(type.publishable ? ['status'] : []),
            ...(type.i18n ? ['locale'] : []),
            ...Object.entries(type.fields)
                .filter(([, spec]) => isScalarField(spec))
                .map(([name]) => name)
        ]);
        const isDesc = !!sort && sort.startsWith('-');
        const columnId = sort ? (isDesc ? sort.slice(1) : sort) : '';

        // The whitelist only admits scalar columns, but guard against a missing
        // column defensively so a sort key never reaches `asc(undefined)`.
        const col = sortable.has(columnId) ? table[columnId] : undefined;
        if (col) {
            return [isDesc ? desc(col) : asc(col), asc(table['id'])];
        }
        return [desc(table['updatedAt']), asc(table['id'])];
    }
}
