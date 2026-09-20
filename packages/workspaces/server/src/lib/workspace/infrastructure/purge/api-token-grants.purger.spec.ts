import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { UnitOfWork } from '@orthacms/database';
import { apiTokens, apiTokenWorkspaces } from '@orthacms/identity-server';
import { ApiTokenGrantsPurger } from './api-token-grants.purger';
import { WorkspacePurgeRegistry } from '../../application/workspace-purge.registry';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

/** A fake executor recording every delete and the rows it returns. */
function fakeExecutor(removed: { tokenId: string }[]) {
    const targets: object[] = [];
    const conditions: unknown[] = [];
    const executor = {
        delete(table: object) {
            targets.push(table);
            return {
                where(condition: unknown) {
                    conditions.push(condition);
                    return { returning: () => Promise.resolve(removed) };
                }
            };
        }
    };
    return { executor, targets, conditions };
}

/** A purger over the fake executor, plus its recording handles. */
function purger(removed: { tokenId: string }[] = []) {
    const { executor, targets, conditions } = fakeExecutor(removed);
    const uow = { current: () => executor } as unknown as UnitOfWork;
    return {
        subject: new ApiTokenGrantsPurger(uow),
        uow,
        targets,
        conditions
    };
}

/** The SQL text of a captured `where` condition. */
function renderedSql(condition: unknown): string {
    return new PgDialect().sqlToQuery(condition as never).sql;
}

/**
 * The one purger that lives on this side of the dependency edge: this package
 * depends on `@orthacms/identity-server`, so identity cannot depend back on it
 * to reach the registry, and the adapter for identity's table sits here.
 *
 * What it removes is a token's **workspace bucket** — which workspaces one API
 * token may act in. `token_id` cascades from `api_tokens`, but `workspace_id`
 * carries no FK by design, so a deleted workspace used to leave a live
 * credential scoped to an id resolving to nothing.
 *
 * The boundary that matters is what it does *not* touch. Deleting the bucket
 * row narrows what a credential can reach; deleting the `api_tokens` row would
 * revoke it. A token scoped to three workspaces keeps working in the other two,
 * and a token left with no buckets is a token that can reach nothing — which is
 * the correct outcome, and not the same as a revoked one. Revocation is a
 * policy decision this purger has no standing to make, so the assertion is
 * quite literally that `api_tokens` never appears in a statement it issues.
 */
describe('ApiTokenGrantsPurger', () => {
    it('deletes from api_token_workspaces and nothing else', async () => {
        const { subject, targets } = purger([{ tokenId: 'token-1' }]);

        await subject.purge(WORKSPACE);

        expect(targets).toEqual([apiTokenWorkspaces]);
        expect(targets.map((table) => getTableName(table as never))).toEqual([
            'api_token_workspaces'
        ]);
    });

    it('never touches api_tokens — narrowing a scope is not revoking a token [workspaces:I-28]', async () => {
        const { subject, targets } = purger([
            { tokenId: 'token-1' },
            { tokenId: 'token-2' }
        ]);

        await subject.purge(WORKSPACE);

        expect(targets).not.toContain(apiTokens);
    });

    it('scopes the delete to the one workspace', async () => {
        const { subject, conditions } = purger();

        await subject.purge(WORKSPACE);

        expect(conditions).toHaveLength(1);
        const { sql, params } = new PgDialect().sqlToQuery(
            conditions[0] as never
        );
        expect(sql).toContain('"workspace_id" =');
        expect(params).toEqual([WORKSPACE]);
        expect(renderedSql(conditions[0])).not.toContain('token_id');
    });

    it('reports the rows it removed', async () => {
        const { subject } = purger([
            { tokenId: 'token-1' },
            { tokenId: 'token-2' }
        ]);

        await expect(subject.purge(WORKSPACE)).resolves.toEqual({ rows: 2 });
    });

    it('reports zero for a workspace no token was scoped to', async () => {
        const { subject } = purger([]);

        await expect(subject.purge(WORKSPACE)).resolves.toEqual({ rows: 0 });
    });

    it('defers nothing — these are rows, not bytes in object storage', async () => {
        const { subject } = purger([{ tokenId: 'token-1' }]);

        // No `reclaim` thunk: everything it removes is transactional, so it
        // commits or rolls back with the workspace and needs no post-commit
        // second phase.
        expect(await subject.purge(WORKSPACE)).not.toHaveProperty('reclaim');
    });

    describe('registration', () => {
        it('joins the registry under a namespaced name', () => {
            const { uow } = purger();
            const registry = new WorkspacePurgeRegistry();
            const subject = new ApiTokenGrantsPurger(uow, registry);

            subject.onModuleInit();

            expect(registry.registered).toEqual([
                'identity:api-token-workspaces'
            ]);
        });

        it('is a no-op when no registry is present', () => {
            // The registry is `@Optional()`: a host that mounted identity but
            // not this plugin's fan-out must still boot.
            const { subject } = purger();

            expect(() => subject.onModuleInit()).not.toThrow();
        });
    });
});
