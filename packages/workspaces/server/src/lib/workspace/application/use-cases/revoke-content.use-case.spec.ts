import type { OutboxWriter, UnitOfWork, DomainEvent } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { RevokeContentUseCase } from './revoke-content.use-case';
import { ContentEntryCounterReader } from '../content/content-entry-counter.reader';
import { Workspace } from '../../domain/workspace';
import type { WorkspaceRepository } from '../../domain/workspace.repository';
import { WORKSPACE_EVENT_KINDS } from '../../domain/events/workspace-events';
import {
    ContentTypeNotEmptyError,
    EntryCountUnavailableError,
    WorkspaceNotFoundError
} from '../../domain/errors';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

const ACTOR = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'grace@example.com'
} as PublicUser;

/** A loaded workspace holding one collection grant. */
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
type Counter = { entries: number } | 'unbound';

/** The use case wired to fakes appending to one ordered `log`. */
function harness(
    options: { workspace?: Workspace | null; counter?: Counter } = {}
) {
    const log: string[] = [];
    const appended: DomainEvent[] = [];
    const workspace =
        options.workspace === undefined ? rehydrated() : options.workspace;
    const counterMode = options.counter ?? { entries: 0 };

    const counter =
        counterMode === 'unbound'
            ? new ContentEntryCounterReader()
            : new ContentEntryCounterReader({
                  countEntries: async () => {
                      log.push('count:type');
                      return counterMode.entries;
                  },
                  countWorkspaceEntries: async () => {
                      log.push('count:workspace');
                      return counterMode.entries;
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
        useCase: new RevokeContentUseCase(uow, outbox, counter, workspaces),
        counter,
        workspace,
        log,
        appended
    };
}

/**
 * Revoking a grant is the delete's smaller sibling and carries the same two
 * rules: it loads under the exclusive content lock, and it refuses outright
 * when the entry count cannot be established. Both are invisible from the
 * response — a revoke that read a stale count still answers 200 with a
 * plausible view — so they are asserted here rather than over HTTP.
 */
describe('RevokeContentUseCase', () => {
    it('revokes an empty type and drains workspace.content_revoked with the actor', async () => {
        const { useCase, log, appended } = harness();

        await useCase.execute(ACTOR, WORKSPACE_ID, 'blog_post');

        expect(log).toEqual([
            'run:start',
            'load:locked',
            'count:type',
            'save',
            'append',
            'run:end'
        ]);
        expect(appended.map((event) => event.kind)).toEqual([
            WORKSPACE_EVENT_KINDS.CONTENT_REVOKED
        ]);
        expect(appended[0].payload).toMatchObject({
            slug: 'blog_post',
            actor: { id: ACTOR.id, email: ACTOR.email }
        });
    });

    describe('an unbound counter fails the revoke closed', () => {
        it('throws EntryCountUnavailableError before counting or saving', async () => {
            const { useCase, log } = harness({ counter: 'unbound' });

            await expect(
                useCase.execute(ACTOR, WORKSPACE_ID, 'blog_post')
            ).rejects.toThrow(EntryCountUnavailableError);

            expect(log).not.toContain('count:type');
            expect(log).not.toContain('save');
            expect(log).not.toContain('append');
        });

        it('while the reader itself still answers 0 for the read-only pre-check', async () => {
            const { counter } = harness({ counter: 'unbound' });

            expect(counter.isBound).toBe(false);
            await expect(
                counter.countEntries(WORKSPACE_ID, 'blog_post')
            ).resolves.toBe(0);
        });
    });

    it('loads under the content lock, never through the plain reader [workspaces:I-16]', async () => {
        const { useCase, log } = harness();

        await useCase.execute(ACTOR, WORKSPACE_ID, 'blog_post');

        expect(log).toContain('load:locked');
        expect(log).not.toContain('load:unlocked');
    });

    it('refuses while the type still holds entries, appending nothing', async () => {
        // The grant is what makes those rows reachable; removing it would
        // orphan them in place rather than delete them.
        const { useCase, log, appended } = harness({ counter: { entries: 4 } });

        await expect(
            useCase.execute(ACTOR, WORKSPACE_ID, 'blog_post')
        ).rejects.toThrow(ContentTypeNotEmptyError);

        expect(log).not.toContain('save');
        expect(appended).toEqual([]);
    });

    it('is a silent no-op for a grant the workspace never held', async () => {
        // Idempotent by design — but a no-op must not write an audit row
        // claiming something was revoked.
        const { useCase, log, appended } = harness();

        await expect(
            useCase.execute(ACTOR, WORKSPACE_ID, 'never_granted')
        ).resolves.toBeUndefined();

        expect(log).not.toContain('save');
        expect(appended).toEqual([]);
    });

    it('404s an unknown workspace', async () => {
        const { useCase, log, appended } = harness({ workspace: null });

        await expect(
            useCase.execute(ACTOR, WORKSPACE_ID, 'blog_post')
        ).rejects.toThrow(WorkspaceNotFoundError);

        expect(log).not.toContain('count:type');
        expect(appended).toEqual([]);
    });

    it('rejects a malformed id before the unit of work opens', async () => {
        const { useCase, log } = harness();

        await expect(
            useCase.execute(ACTOR, 'not-a-uuid', 'blog_post')
        ).rejects.toThrow();

        expect(log).toEqual([]);
    });
});
