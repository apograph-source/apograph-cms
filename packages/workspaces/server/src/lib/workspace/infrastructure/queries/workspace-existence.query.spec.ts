import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@orthacms/database';
import { WorkspaceExistenceQuery } from './workspace-existence.query';

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const ARCHIVED = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

/** A fake database returning `rows`, recording the query it was asked for. */
function fakeDb(rows: { id: string }[]) {
    const tables: string[] = [];
    const conditions: unknown[] = [];
    const db = {
        select() {
            return {
                from(table: object) {
                    tables.push(getTableName(table as never));
                    return {
                        where(condition: unknown) {
                            conditions.push(condition);
                            return Promise.resolve(rows);
                        }
                    };
                }
            };
        }
    };
    return {
        query: new WorkspaceExistenceQuery(db as unknown as Database),
        tables,
        conditions
    };
}

/** The SQL text of a captured `where` condition. */
function renderedSql(condition: unknown): string {
    return new PgDialect().sqlToQuery(condition as never).sql;
}

/**
 * The adapter behind identity's `WORKSPACE_DIRECTORY` port — what stands
 * between a typo and an API token scoped to a workspace that does not exist.
 * `api_token_workspaces` carries no cross-plugin foreign key by design, so this
 * check is the only referential integrity that bucket has.
 *
 * The invariant worth pinning is what "existing" means. It is **existence, not
 * status**: an archived workspace is a perfectly valid scope for a token — it
 * is dormant, not deleted, and unarchiving must not silently leave a
 * credential's bucket short an entry it used to hold. A `status = 'active'`
 * added to the predicate would look like tightening and would in fact break
 * every token scoped to a workspace someone archived.
 */
describe('WorkspaceExistenceQuery', () => {
    it('short-circuits an empty request without touching the database', async () => {
        // A token minted with no workspace bucket is ordinary — it must not
        // cost a round-trip, and `in ()` is not valid SQL anyway.
        const { query, tables } = fakeDb([]);

        await expect(query.existing([])).resolves.toEqual([]);
        expect(tables).toEqual([]);
    });

    it('asks the workspaces table once for the whole set', async () => {
        // One `IN`, never one query per id: a bucket may name a hundred.
        const { query, tables, conditions } = fakeDb([
            { id: ACTIVE },
            { id: ARCHIVED }
        ]);

        await query.existing([ACTIVE, ARCHIVED, GONE]);

        expect(tables).toEqual(['workspaces']);
        expect(renderedSql(conditions[0])).toContain('"id" in');
    });

    it('filters on nothing but the id — an archived workspace still exists [workspaces:I-27]', async () => {
        const { query, conditions } = fakeDb([{ id: ARCHIVED }]);

        const found = await query.existing([ARCHIVED]);

        expect(renderedSql(conditions[0])).not.toContain('status');
        expect(found).toEqual([ARCHIVED]);
    });

    it('returns only the ids that came back, dropping the unknown one', async () => {
        const { query } = fakeDb([{ id: ACTIVE }, { id: ARCHIVED }]);

        await expect(query.existing([ACTIVE, ARCHIVED, GONE])).resolves.toEqual(
            [ACTIVE, ARCHIVED]
        );
    });

    it('accepts a readonly array without mutating the given bucket', async () => {
        const bucket: readonly string[] = Object.freeze([ACTIVE]);
        const { query } = fakeDb([{ id: ACTIVE }]);

        await expect(query.existing(bucket)).resolves.toEqual([ACTIVE]);
        expect(bucket).toEqual([ACTIVE]);
    });
});
