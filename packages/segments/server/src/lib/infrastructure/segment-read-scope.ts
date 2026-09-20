import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type {
    ContentReadScope,
    ContentReadScopeContext
} from '@orthacms/content-server';
import { entryAccess } from '../schema/entry-access';
import { SegmentCatalogService } from '../application/segment-catalog.service';
import { ReaderStore } from '../application/reader.store';
import { uuidArray } from './uuid-array';

/**
 * The enforcement — one predicate AND-ed onto every public content read.
 *
 * ```sql
 * COALESCE((
 *   SELECT NOT (ea.deny && $reader)
 *      AND (cardinality(ea.allow) = 0 OR ea.allow && $reader)
 *   FROM entry_access ea WHERE ea.entry_id = article.id
 * ), true)
 * ```
 *
 * That is `canRead` from the kernel, in SQL, and the correspondence is worth
 * keeping line for line: the deny check first, an empty allow list meaning
 * everyone, otherwise an intersection. The kernel's spec test is what says the
 * three rules are right; this is what says the database agrees.
 *
 * **`COALESCE(…, true)` is the load-bearing half.** An entry with no row is
 * unrestricted — the state every entry is in until somebody decides otherwise —
 * so the subquery returning `NULL` has to read as "yes". Written without it, the
 * whole library would go dark the moment the plugin was installed.
 *
 * **An empty reader still works.** `&& '{}'` is false either way: the anonymous
 * reader is denied by nothing and admitted by no allow list, which is exactly
 * the intent.
 *
 * Emitted **only when a segment exists**. With none, the scope returns
 * `undefined`, no fragment is added, and the read is byte-for-byte what it was
 * before — which is what makes installing this plugin a no-op until it is used.
 */
@Injectable()
export class SegmentReadScope implements ContentReadScope {
    constructor(
        private readonly catalog: SegmentCatalogService,
        private readonly reader: ReaderStore
    ) {}

    scope(context: ContentReadScopeContext): SQL | undefined {
        if (!this.catalog.configured) {
            return undefined;
        }

        const columns = context.type.table as unknown as Record<
            string,
            PgColumn | undefined
        >;
        const idColumn = columns['id'];
        if (!idColumn) {
            // Every content table has one; a type that somehow does not cannot
            // be matched against the projection, and silently skipping the
            // fragment would serve restricted content. Fail loudly instead.
            throw new Error(
                `Content type "${context.type.name}" has no "id" column, so reader access cannot be enforced on it.`
            );
        }

        // One bind parameter, cast at the boundary: an empty array literal has
        // no element type in Postgres, and `uuid[] && text[]` is an operator
        // error rather than a false. See `uuidArray` for why the obvious
        // spelling of this is wrong.
        const ids = uuidArray([...this.reader.current().segmentIds]);

        return sql`COALESCE((
            SELECT NOT (${entryAccess.deny} && ${ids})
               AND (cardinality(${entryAccess.allow}) = 0 OR ${entryAccess.allow} && ${ids})
            FROM ${entryAccess}
            WHERE ${entryAccess.entryId} = ${idColumn}
        ), true)`;
    }
}
