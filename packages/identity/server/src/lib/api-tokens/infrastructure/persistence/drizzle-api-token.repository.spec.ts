import { getTableName } from 'drizzle-orm';
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import type { UnitOfWork } from '@orthacms/database';
import { DrizzleApiTokenRepository } from './drizzle-api-token.repository';

const TOKEN = '99999999-9999-4999-8999-999999999999';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';

/** An `api_tokens` row as the driver hands it back. */
const ROW = {
    id: TOKEN,
    name: 'CI',
    tokenHash: 'a'.repeat(64),
    lookupPrefix: 'orthacms_abc',
    scope: 'read',
    expiresAt: null,
    createdBy: 'user-1',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z')
};

/** One recorded statement: where it was rooted, and the builder behind it. */
interface Statement {
    table: string;
    /** True when the select carried an explicit projection. */
    projected: boolean;
    /** The finished builder — renderable to SQL after the call returns. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: any;
}

/** The rows a statement resolves to, chosen by table and projection. */
type Rows = (table: string, projected: boolean) => unknown[];

/**
 * A `UnitOfWork` whose `current()` hands back **real** Drizzle select builders,
 * from the standalone `QueryBuilder` that needs no connection, with `execute`
 * swapped for canned rows (`QueryPromise.then` defers to `execute`, so that is
 * all it takes to make a connection-free builder awaitable).
 *
 * Real builders are the point: the thing under test is how a filter *renders*,
 * and a hand-rolled chain stub would happily accept a subquery it could never
 * have produced.
 */
function fakeUow(rows: Rows) {
    const statements: Statement[] = [];
    const builder = new QueryBuilder();
    const current = () => ({
        select(projection?: Record<string, unknown>) {
            return {
                from(table: object) {
                    const select = (projection
                        ? builder.select(projection as never)
                        : builder.select()
                    ).from(table as never) as unknown as Statement['select'];
                    const name = getTableName(table as never);
                    const projected = projection !== undefined;
                    select.execute = async () => rows(name, projected);
                    statements.push({ table: name, projected, select });
                    return select;
                }
            };
        }
    });
    return {
        repo: new DrizzleApiTokenRepository({
            current
        } as unknown as UnitOfWork),
        statements
    };
}

/** The SQL a recorded statement renders to. */
function sqlOf(statement: Statement): string {
    return new PgDialect().sqlToQuery(statement.select.getSQL()).sql;
}

/** The single statement rooted at `table` with the given projection-ness. */
function only(
    statements: Statement[],
    table: string,
    projected: boolean
): Statement {
    const found = statements.filter(
        (statement) =>
            statement.table === table && statement.projected === projected
    );
    expect(found).toHaveLength(1);
    return found[0];
}

/** The default row set: one token, in both workspaces. */
const bothWorkspaces: Rows = (table, projected) => {
    if (table === 'api_tokens') {
        return projected ? [{ total: 1 }] : [ROW];
    }
    return [
        { tokenId: TOKEN, workspaceId: WORKSPACE_A },
        { tokenId: TOKEN, workspaceId: WORKSPACE_B }
    ];
};

describe('DrizzleApiTokenRepository.list', () => {
    it('renders the workspace filter as a set-membership subquery', async () => {
        // `?workspaceId=` is a bucket-*membership* test, and the shape it is
        // written in is the whole invariant: a join against
        // `api_token_workspaces` would return one row per matching workspace,
        // so a token covering three workspaces would appear three times in the
        // page and inflate the total by three. `id IN (SELECT …)` cannot.
        const { repo, statements } = fakeUow(bothWorkspaces);

        await repo.list({ workspaceId: WORKSPACE_A, limit: 20, offset: 0 });

        const page = sqlOf(only(statements, 'api_tokens', false));
        expect(page).toContain(
            '"api_tokens"."id" in (select "token_id" from "api_token_workspaces"'
        );
        expect(page.toLowerCase()).not.toContain('join');
    });

    it('filters the count with the identical predicate', async () => {
        // The total and the page are two statements sharing one `where`. If
        // they ever drifted, the pager would show a page count for a set the
        // page itself does not come from.
        const { repo, statements } = fakeUow(bothWorkspaces);

        await repo.list({ workspaceId: WORKSPACE_A, limit: 20, offset: 0 });

        const predicate = (sql: string) => sql.slice(sql.indexOf(' where '));
        const total = sqlOf(only(statements, 'api_tokens', true));
        const page = sqlOf(only(statements, 'api_tokens', false));
        expect(total).toContain('count(*)');
        expect(predicate(total)).toBe(
            predicate(page).replace(/ order by .*$/, '')
        );
    });

    it('returns a multi-workspace token exactly once, with its whole bucket [api-tokens:I-20]', async () => {
        const { repo } = fakeUow(bothWorkspaces);

        const { items, total } = await repo.list({
            workspaceId: WORKSPACE_A,
            limit: 20,
            offset: 0
        });

        expect(items).toHaveLength(1);
        expect(total).toBe(1);
        // The bucket is part of the token's identity, not an expansion: every
        // read hands it back so no caller can observe a token scoped to
        // nothing.
        expect(items[0].workspaceIds).toEqual([WORKSPACE_A, WORKSPACE_B]);
    });

    it('adds no predicate at all when no workspace is named', async () => {
        const { repo, statements } = fakeUow(bothWorkspaces);

        await repo.list({ limit: 20, offset: 0 });

        for (const projected of [true, false]) {
            expect(
                sqlOf(only(statements, 'api_tokens', projected))
            ).not.toContain('where');
        }
        // No subquery was built either — an unfiltered list must not pay for
        // one.
        expect(
            statements.filter(
                (statement) =>
                    statement.table === 'api_token_workspaces' &&
                    statement.projected
            )
        ).toEqual([]);
    });

    it('reads every bucket on the page in one batched query', async () => {
        // Never one query per row: a page of tokens costs a constant two reads
        // plus the count, whatever the page size.
        const { repo, statements } = fakeUow((table, projected) => {
            if (table === 'api_tokens') {
                return projected
                    ? [{ total: 2 }]
                    : [ROW, { ...ROW, id: 'token-2' }];
            }
            return [
                { tokenId: TOKEN, workspaceId: WORKSPACE_A },
                { tokenId: 'token-2', workspaceId: WORKSPACE_B }
            ];
        });

        const { items } = await repo.list({ limit: 20, offset: 0 });

        const bucketReads = statements.filter(
            (statement) =>
                statement.table === 'api_token_workspaces' &&
                !statement.projected
        );
        expect(bucketReads).toHaveLength(1);
        expect(sqlOf(bucketReads[0])).toContain('"token_id" in');
        expect(items.map((item) => item.workspaceIds)).toEqual([
            [WORKSPACE_A],
            [WORKSPACE_B]
        ]);
    });

    it('skips the bucket read entirely for an empty page', async () => {
        // `in ()` is not valid SQL, so the short-circuit is correctness, not an
        // optimisation.
        const { repo, statements } = fakeUow((table, projected) =>
            table === 'api_tokens' && projected ? [{ total: 0 }] : []
        );

        const { items } = await repo.list({ limit: 20, offset: 40 });

        expect(items).toEqual([]);
        expect(
            statements.filter(
                (statement) => statement.table === 'api_token_workspaces'
            )
        ).toEqual([]);
    });
});
