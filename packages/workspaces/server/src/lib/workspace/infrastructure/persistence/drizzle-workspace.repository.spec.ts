import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { UnitOfWork } from '@orthacms/database';
import { DrizzleWorkspaceRepository } from './drizzle-workspace.repository';
import { WorkspaceMapper } from './workspace.mapper';
import { Workspace } from '../../domain/workspace';
import { Slug } from '../../domain/value-objects/slug';
import { WorkspaceColor } from '../../domain/value-objects/workspace-color';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import { SlugTakenError } from '../../domain/errors';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';

/** The `workspaces` row `load` selects. */
const ROW = {
    id: WORKSPACE_ID,
    name: 'Marketing',
    slug: 'marketing',
    description: 'The marketing team',
    color: 'slate',
    status: 'active',
    createdAt: new Date(0),
    updatedAt: new Date(0)
};

/** Awaitable query builder: every chain method returns the same rows. */
function chain<T>(rows: T[]) {
    const awaitable = Promise.resolve(rows) as Promise<T[]> & {
        where(condition?: unknown): typeof awaitable;
        limit(count: number): typeof awaitable;
        orderBy(...order: unknown[]): typeof awaitable;
        onConflictDoNothing(): typeof awaitable;
        returning(projection?: unknown): typeof awaitable;
    };
    awaitable.where = () => awaitable;
    awaitable.limit = () => awaitable;
    awaitable.orderBy = () => awaitable;
    awaitable.onConflictDoNothing = () => awaitable;
    awaitable.returning = () => awaitable;
    return awaitable;
}

/**
 * A Drizzle executor that records the statements it is handed, in order.
 * `insertFails` makes the next insert against that table throw, standing in
 * for the unique index rejecting a duplicate slug.
 */
function fakeExecutor(options: { insertFails?: unknown } = {}) {
    const log: string[] = [];
    const executed: unknown[] = [];
    const executor = {
        execute(statement: unknown) {
            log.push('execute');
            executed.push(statement);
            return Promise.resolve([]);
        },
        select() {
            return {
                from(table: object) {
                    log.push(`select:${getTableName(table as never)}`);
                    const rows =
                        getTableName(table as never) === 'workspaces'
                            ? [ROW]
                            : [];
                    return chain(rows);
                }
            };
        },
        insert(table: object) {
            log.push(`insert:${getTableName(table as never)}`);
            return {
                values() {
                    if (options.insertFails !== undefined) {
                        throw options.insertFails;
                    }
                    return chain([]);
                }
            };
        },
        update(table: object) {
            log.push(`update:${getTableName(table as never)}`);
            return { set: () => chain([]) };
        },
        delete(table: object) {
            log.push(`delete:${getTableName(table as never)}`);
            return chain([]);
        }
    };
    return { executor, log, executed };
}

/** A repository over the fake executor, plus its recording handles. */
function repository(options: { insertFails?: unknown } = {}) {
    const { executor, log, executed } = fakeExecutor(options);
    const uow = { current: () => executor } as unknown as UnitOfWork;
    return {
        repo: new DrizzleWorkspaceRepository(uow, new WorkspaceMapper()),
        log,
        executed
    };
}

/** The SQL text of a statement handed to `execute`. */
function renderedSql(statement: unknown): string {
    return new PgDialect().sqlToQuery(statement as never).sql;
}

/** A brand-new aggregate — the only path that inserts a `workspaces` row. */
function newWorkspace(): Workspace {
    return Workspace.create({
        name: 'Marketing',
        slug: Slug.create('marketing'),
        description: '',
        color: WorkspaceColor.default(),
        creatorUserId: CREATOR,
        memberUserIds: [],
        grants: []
    });
}

describe('DrizzleWorkspaceRepository', () => {
    const id = WorkspaceId.create(WORKSPACE_ID);

    /**
     * The delete and revoke invariants read a count and *then* mutate. Without
     * coordination an entry create lands between the two and is orphaned by a
     * check that already passed — so the destructive path takes the workspace's
     * exclusive advisory lock and entry writes take the shared one.
     *
     * Which loader a use case picks is therefore load-bearing, and the lock is
     * invisible from outside: an e2e test sees the same rows either way unless
     * it can reproduce a race. What a unit test *can* see is the ordering — the
     * lock has to be taken **before** the read, or the read it was meant to
     * protect has already happened by the time it is held.
     */
    describe('findByIdForContentMutation', () => {
        it('locks before it selects', async () => {
            const { repo, log } = repository();

            await repo.findByIdForContentMutation(id);

            expect(log[0]).toBe('execute');
            expect(log[1]).toBe('select:workspaces');
        });

        it('takes the exclusive lock, not the shared one entry writes take [workspaces:I-16]', async () => {
            const { repo, executed } = repository();

            await repo.findByIdForContentMutation(id);

            expect(executed).toHaveLength(1);
            const sql = renderedSql(executed[0]);
            expect(sql).toContain('pg_advisory_xact_lock(');
            expect(sql).not.toContain('pg_advisory_xact_lock_shared');
        });

        it('still loads the whole aggregate', async () => {
            const { repo } = repository();

            const workspace = await repo.findByIdForContentMutation(id);

            expect(workspace?.id.value).toBe(WORKSPACE_ID);
            expect(workspace?.slug.value).toBe('marketing');
        });
    });

    describe('findById', () => {
        it('takes no lock — an ordinary read must not serialize entry writes', async () => {
            const { repo, log, executed } = repository();

            await repo.findById(id);

            expect(log).not.toContain('execute');
            expect(executed).toEqual([]);
        });

        it('reads the aggregate from its three tables', async () => {
            const { repo, log } = repository();

            await repo.findById(id);

            expect(log).toEqual([
                'select:workspaces',
                'select:memberships',
                'select:workspace_content'
            ]);
        });
    });

    /**
     * The pre-insert availability check cannot be authoritative, so the unique
     * index is what actually decides — and its rejection has to come back out
     * as the same domain error the pre-check raises, or the loser of an
     * ordinary race gets a 500 for a collision that has always meant 409.
     */
    describe('save', () => {
        it('turns the slug unique violation into SlugTakenError [workspaces:I-10]', async () => {
            const { repo } = repository({
                insertFails: Object.assign(new Error('Failed query'), {
                    cause: {
                        code: '23505',
                        constraint: 'workspaces_slug_unique'
                    }
                })
            });

            await expect(repo.save(newWorkspace())).rejects.toThrow(
                new SlugTakenError('marketing')
            );
        });

        it('names the slug that collided', async () => {
            const { repo } = repository({
                insertFails: {
                    code: '23505',
                    constraint: 'workspaces_slug_unique'
                }
            });

            await expect(repo.save(newWorkspace())).rejects.toMatchObject({
                slug: 'marketing'
            });
        });

        it.each([
            [
                'a different constraint',
                {
                    code: '23505',
                    constraint: 'memberships_workspace_id_user_id_unique'
                }
            ],
            [
                'a foreign-key violation',
                { code: '23503', constraint: 'workspaces_slug_unique' }
            ]
        ])('rethrows %s unchanged', async (_label, thrown) => {
            // Translating anything broader would hide a real integrity failure
            // behind a 409 that tells the user to pick another name.
            const { repo } = repository({ insertFails: thrown });

            await expect(repo.save(newWorkspace())).rejects.toBe(thrown);
        });

        it('rethrows a plain error unchanged', async () => {
            const thrown = new Error('connection lost');
            const { repo } = repository({ insertFails: thrown });

            await expect(repo.save(newWorkspace())).rejects.toBe(thrown);
        });
    });
});
