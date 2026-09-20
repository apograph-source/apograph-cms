import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, exists, not, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    AnyContentType,
    EntryFilterContext,
    EntryFilterExtension,
    EntryFilterProvider
} from '@orthacms/content-server';
import {
    FilterOperator,
    ScalarFieldType,
    type FieldSchema,
    type ParsedRule
} from '@orthacms/utils-server';
import { entryAccess } from '../schema/entry-access';
import { SegmentCatalogService } from '../application/segment-catalog.service';
import { uuidArray } from './uuid-array';

/**
 * The three virtual filter fields, by wire name.
 *
 * Flat names rather than a dotted `access.allow`: the filter parser walks a
 * dotted path segment-by-segment as a **relation** traversal, and these are not
 * relations — they are answered by a subquery over a table content-server has
 * never heard of.
 */
export const ACCESS_FILTER_FIELD = {
    /** Entries whose allow list names any of the given audiences. */
    Allowed: 'audienceAllowed',
    /** Entries whose deny list names any of the given audiences. */
    Denied: 'audienceDenied',
    /** Whether the entry names any audience at all. */
    Restricted: 'accessRestricted'
} as const;

/** The operators each field can actually answer. */
const FIELD_OPS: Record<string, ReadonlySet<string>> = {
    [ACCESS_FILTER_FIELD.Allowed]: new Set([
        FilterOperator.Eq,
        FilterOperator.In
    ]),
    [ACCESS_FILTER_FIELD.Denied]: new Set([
        FilterOperator.Eq,
        FilterOperator.In
    ]),
    [ACCESS_FILTER_FIELD.Restricted]: new Set([FilterOperator.Eq])
};

/**
 * Filtering a collection's records by **who can read them**.
 *
 * Three fields, and they are the three questions an editor actually has:
 * "everything Acme can see", "everything hidden from Acme", and "everything I
 * have restricted at all". Contributed through content's filter-field registry,
 * so they join the records list's own query builder rather than living on a
 * screen of their own — the same filter tree, the same saved views, the same
 * alarm rules.
 *
 * ## Why not a relation
 *
 * The obvious framing is "audiences are a relation on the entry", and the query
 * builder does have a relation picker. But a relation there means a **content
 * type**: the picker fetches `/content/<target>`, the filter surface walks the
 * target's own fields, and a rule can hop through it. An audience is none of
 * those — it is a row in this plugin's table with no content model behind it.
 * Modelling it as a relation would advertise a traversal (`audience.tags eq …`)
 * that nothing can answer. Enum-shaped virtual fields say exactly as much as is
 * true.
 *
 * ## What the operators mean
 *
 * `in` is **any of**, not all of: `audienceAllowed in [acme, globex]` is every
 * entry either of them may read. "Both" is an `and` of two `eq` rules, which the
 * builder composes; there is no array-containment operator to confuse it with.
 *
 * Negation is deliberately absent. `audienceAllowed ne "acme"` would negate
 * *inside* the EXISTS — "has some allowed audience other than Acme" — which an
 * entry that also allows Acme satisfies. That reads as "not visible to Acme" and
 * is not it. The honest spelling of that question is `audienceDenied eq "acme"`
 * for an explicit refusal, or `accessRestricted eq true` combined with a `not`
 * group at the tree level, which the builder owns.
 *
 * ## What it is not
 *
 * A filter narrows a list; it is not a visibility rule. Who may actually *read*
 * an entry is `SegmentReadScope` on the public API, applied separately and
 * unaffected by anything here. This is the editor's list, and an editor sees
 * their workspace's records either way.
 */
@Injectable()
export class AccessFilterProvider implements EntryFilterProvider {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly catalog: SegmentCatalogService
    ) {}

    /**
     * The fields, or `undefined` when no audience exists.
     *
     * Nothing configured means the feature is inert, so the picker must not
     * offer a field whose every value list is empty — an enum with no values is
     * a rule nobody can complete.
     */
    filterFor(type: AnyContentType): EntryFilterExtension | undefined {
        if (!this.catalog.configured) return undefined;
        // Ids, not keys: an entry's lists hold ids, and the whole point of the
        // segment indirection is that a key can be renamed without touching
        // them. The admin's picker labels them.
        const ids = this.catalog.all().map((segment) => segment.id);
        const fields: FieldSchema = {
            [ACCESS_FILTER_FIELD.Allowed]: {
                type: ScalarFieldType.Enum,
                enumValues: ids
            },
            [ACCESS_FILTER_FIELD.Denied]: {
                type: ScalarFieldType.Enum,
                enumValues: ids
            },
            [ACCESS_FILTER_FIELD.Restricted]: {
                type: ScalarFieldType.Boolean
            }
        };
        return {
            fields,
            resolve: (rule, context) => this.resolve(rule, context)
        };
    }

    /** Translate one virtual access rule into SQL. */
    private async resolve(
        rule: ParsedRule,
        context: EntryFilterContext
    ): Promise<SQL> {
        const field = rule.path[0];
        if (!FIELD_OPS[field]?.has(rule.op)) {
            throw new BadRequestException(
                `Operator "${rule.op}" is not supported on "${field}".`
            );
        }
        const { type, workspaceId } = context;
        const columns = type.table as unknown as Record<
            string,
            PgColumn | undefined
        >;
        const idColumn = columns['id'];
        if (!idColumn) {
            throw new Error(
                `Content type "${type.name}" has no "id" column to match access against.`
            );
        }

        // The row scope every one of the three shares. **Workspace-scoped**: a
        // virtual field is a subquery over a table content-server does not
        // know, and one that forgets the workspace turns a filter into a
        // cross-tenant read.
        const forThisEntry = and(
            eq(entryAccess.entryId, idColumn),
            eq(entryAccess.workspaceId, workspaceId)
        );
        const rows = this.db.select({ one: sql`1` }).from(entryAccess);

        if (field === ACCESS_FILTER_FIELD.Restricted) {
            const restricted = exists(rows.where(forThisEntry));
            // A row exists only while at least one list is non-empty (the
            // writer deletes it otherwise), so "has a row" *is* "is restricted"
            // — no cardinality check needed here, and none that could drift
            // from the writer's rule.
            return rule.value === true ? restricted : not(restricted);
        }

        const wanted = this.idsOf(rule, field);
        const column =
            field === ACCESS_FILTER_FIELD.Allowed
                ? entryAccess.allow
                : entryAccess.deny;
        // `&&` is array overlap: **any** of the named audiences. "All of them"
        // is an `and` of single-value rules, which the query builder composes —
        // one operator with two readings would be the thing nobody could keep
        // straight.
        return exists(
            rows.where(
                and(forThisEntry, sql`${column} && ${uuidArray(wanted)}`)
            )
        );
    }

    /**
     * The rule's value as a list of segment ids.
     *
     * The parser has already coerced against the declared enum, so an id that is
     * not a live segment cannot arrive — which matters more than it looks: an
     * unchecked value reaching `::uuid[]` would be a Postgres cast error, i.e. a
     * 500 on ordinary bad input.
     */
    private idsOf(rule: ParsedRule, field: string): string[] {
        const raw = Array.isArray(rule.value) ? rule.value : [rule.value];
        const ids = raw.filter(
            (value): value is string => typeof value === 'string'
        );
        if (!ids.length) {
            throw new BadRequestException(
                `"${field}" needs at least one audience.`
            );
        }
        return ids;
    }
}
