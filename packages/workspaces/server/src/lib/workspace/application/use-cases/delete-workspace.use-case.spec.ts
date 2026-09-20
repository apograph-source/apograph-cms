import type { OutboxWriter, UnitOfWork, DomainEvent } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { ContentEntryCounterReader } from '../content/content-entry-counter.reader';
import { WorkspacePurgeRegistry } from '../workspace-purge.registry';
import { Workspace } from '../../domain/workspace';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import type { WorkspaceRepository } from '../../domain/workspace.repository';
import { WORKSPACE_EVENT_KINDS } from '../../domain/events/workspace-events';
import {
    EntryCountUnavailableError,
    WorkspaceNotEmptyError,
    WorkspaceNotFoundError
} from '../../domain/errors';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

const ACTOR = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'grace@example.com'
} as PublicUser;

/** A loaded workspace with one member and one collection grant. */
function rehydrated(): Workspace {
    return Workspace.rehydrate({
        id: WORKSPACE_ID,
        name: 'Marketing',
        slug: 'marketing',
        description: '',
        color: 'slate',
        status: 'active',
        memberUserIds: [MEMBER],
        grants: [{ kind: 'collection', slug: 'blog_post' }]
    });
}

/** How the counter port is (or is not) bound for a case. */
type Counter = { workspaceEntries: number } | 'unbound';

/**
 * The use case under test, wired to fakes that append to one ordered `log` —
 * so the assertions can be about *sequence*, which is what almost every rule
 * here actually is.
 */
function harness(
    options: {
        workspace?: Workspace | null;
        counter?: Counter;
        purgeThrows?: boolean;
    } = {}
) {
    const log: string[] = [];
    const appended: DomainEvent[] = [];
    const workspace =
        options.workspace === undefined ? rehydrated() : options.workspace;
    const counterMode = options.counter ?? { workspaceEntries: 0 };

    const counter =
        counterMode === 'unbound'
            ? new ContentEntryCounterReader()
            : new ContentEntryCounterReader({
                  countEntries: async () => {
                      log.push('count:type');
                      return counterMode.workspaceEntries;
                  },
                  countWorkspaceEntries: async () => {
                      log.push('count:workspace');
                      return counterMode.workspaceEntries;
                  }
              });

    const purgers = new WorkspacePurgeRegistry();
    purgers.register({
        purgeName: 'media',
        purge: async () => {
            log.push('purge');
            if (options.purgeThrows) {
                throw new Error('connection lost');
            }
            return {
                rows: 1,
                reclaim: async () => {
                    log.push('reclaim');
                }
            };
        }
    });

    const workspaces = {
        findById: async () => {
            log.push('load:unlocked');
            return workspace;
        },
        findByIdForContentMutation: async () => {
            log.push('load:locked');
            return workspace;
        },
        save: async () => {
            log.push('save');
        },
        delete: async () => {
            log.push('delete');
        },
        existsBySlug: async () => false
    } as WorkspaceRepository;

    const uow = {
        run: async <T>(fn: () => Promise<T>): Promise<T> => {
            log.push('run:start');
            const result = await fn();
            log.push('run:end');
            return result;
        }
    } as unknown as UnitOfWork;

    const outbox = {
        append: async (events: DomainEvent[]) => {
            log.push('append');
            appended.push(...events);
        }
    } as unknown as OutboxWriter;

    return {
        useCase: new DeleteWorkspaceUseCase(
            uow,
            outbox,
            counter,
            purgers,
            workspaces
        ),
        counter,
        log,
        appended
    };
}

/**
 * Deleting a workspace is the one operation here that destroys rows across
 * plugins, so almost everything worth asserting about it is an *ordering*:
 * which loader, purge before the row, reclaim after the commit. None of those
 * are visible in the response — a delete that ran its steps in the wrong order
 * still answers 204 — which is what makes them unit-test work rather than e2e
 * work.
 */
describe('DeleteWorkspaceUseCase', () => {
    it('deletes an empty workspace and drains workspace.deleted with the actor', async () => {
        const { useCase, log, appended } = harness();

        await useCase.execute(ACTOR, WORKSPACE_ID);

        expect(appended.map((event) => event.kind)).toEqual([
            WORKSPACE_EVENT_KINDS.DELETED
        ]);
        expect(appended[0].aggregateId).toBe(WORKSPACE_ID);
        expect(appended[0].payload).toMatchObject({
            slug: 'marketing',
            actor: { id: ACTOR.id, email: ACTOR.email }
        });
        expect(log).toContain('delete');
    });

    describe('an unbound counter fails the delete closed', () => {
        it('throws EntryCountUnavailableError before counting or deleting', async () => {
            // The unbound fallback reads 0, which is precisely the case where
            // the guard is blindest — the `content_*` tables are created by
            // migrations and outlive any one boot's plugin list, so a host
            // started without the content plugin can face a database full of
            // entries while reporting none.
            const { useCase, log } = harness({ counter: 'unbound' });

            await expect(useCase.execute(ACTOR, WORKSPACE_ID)).rejects.toThrow(
                EntryCountUnavailableError
            );

            expect(log).not.toContain('count:workspace');
            expect(log).not.toContain('purge');
            expect(log).not.toContain('delete');
            expect(log).not.toContain('append');
        });

        it('while the reader itself still answers 0 for the read-only pre-check', async () => {
            // Both halves of the same object: the endpoints that only *show* a
            // count keep working, and the path that would destroy data refuses.
            const { counter } = harness({ counter: 'unbound' });

            expect(counter.isBound).toBe(false);
            await expect(
                counter.countWorkspaceEntries(WORKSPACE_ID)
            ).resolves.toBe(0);
            await expect(
                counter.countEntries(WORKSPACE_ID, 'blog_post')
            ).resolves.toBe(0);
        });
    });

    describe('ordering', () => {
        it('loads under the content lock, never through the plain reader [workspaces:I-16]', async () => {
            // `findById` would let a concurrent entry create land between the
            // count and the delete — the exact race the exclusive advisory
            // lock exists to close.
            const { useCase, log } = harness();

            await useCase.execute(ACTOR, WORKSPACE_ID);

            expect(log).toContain('load:locked');
            expect(log).not.toContain('load:unlocked');
        });

        it('purges inside the unit of work and before the workspace row goes [workspaces:I-17]', async () => {
            const { useCase, log } = harness();

            await useCase.execute(ACTOR, WORKSPACE_ID);

            expect(log).toEqual([
                'run:start',
                'load:locked',
                'count:workspace',
                'purge',
                'delete',
                'append',
                'run:end',
                'reclaim'
            ]);
        });

        it('runs the reclaim thunk only after the run resolves [workspaces:I-18]', async () => {
            // Blobs in object storage cannot join a transaction, so destroying
            // them before the commit would strand a surviving workspace's
            // bytes on a rollback.
            const { useCase, log } = harness();

            await useCase.execute(ACTOR, WORKSPACE_ID);

            expect(log.indexOf('reclaim')).toBeGreaterThan(
                log.indexOf('run:end')
            );
        });

        it('never reclaims when the transaction rejects', async () => {
            const { useCase, log } = harness({
                counter: { workspaceEntries: 3 }
            });

            await expect(useCase.execute(ACTOR, WORKSPACE_ID)).rejects.toThrow(
                WorkspaceNotEmptyError
            );

            expect(log).not.toContain('reclaim');
        });

        it('never reclaims when a purger throws', async () => {
            // A partial purge is the orphaning this exists to prevent: the
            // rows roll back, so the bytes must stay too.
            const { useCase, log } = harness({ purgeThrows: true });

            await expect(useCase.execute(ACTOR, WORKSPACE_ID)).rejects.toThrow(
                'connection lost'
            );

            expect(log).not.toContain('delete');
            expect(log).not.toContain('reclaim');
        });
    });

    describe('refusals', () => {
        it('refuses while content entries remain, appending nothing', async () => {
            const { useCase, log, appended } = harness({
                counter: { workspaceEntries: 2 }
            });

            await expect(useCase.execute(ACTOR, WORKSPACE_ID)).rejects.toThrow(
                WorkspaceNotEmptyError
            );

            expect(appended).toEqual([]);
            expect(log).not.toContain('purge');
            expect(log).not.toContain('delete');
        });

        it('404s an unknown workspace without purging anything', async () => {
            const { useCase, log, appended } = harness({ workspace: null });

            await expect(useCase.execute(ACTOR, WORKSPACE_ID)).rejects.toThrow(
                WorkspaceNotFoundError
            );

            expect(log).not.toContain('purge');
            expect(appended).toEqual([]);
        });

        it('rejects a malformed id before the unit of work opens', async () => {
            const { useCase, log } = harness();

            await expect(
                useCase.execute(ACTOR, 'not-a-uuid')
            ).rejects.toThrow();

            expect(log).toEqual([]);
            expect(() => WorkspaceId.create('not-a-uuid')).toThrow();
        });
    });
});
