import { Logger } from '@nestjs/common';
import type { DomainEvent } from '@ortha/database';
import { EntryPublishedSubscriber } from './entry-published.subscriber';

const ENTRY = '44444444-4444-4444-8444-444444444444';

/**
 * A published event as the outbox dispatcher hands one over — keyed to the
 * entry, which is the only field this subscriber reads.
 */
function published(entryId: string | null = ENTRY): DomainEvent {
    return {
        kind: 'entry.published',
        aggregateType: 'content_entry',
        aggregateId: entryId,
        payload: {}
    } as unknown as DomainEvent;
}

/**
 * A request store that answers once and then behaves like a real one: the row
 * it returned is no longer open, because resolving it closed it.
 */
function store(openRequestId: string | null) {
    const resolved: string[] = [];
    let open = openRequestId;
    return {
        resolved,
        repository: {
            findOpenByEntry: async () => (open ? { id: open } : null),
            resolve: async (id: string) => {
                resolved.push(id);
                // `resolve` is a conditional update in the real repository —
                // `where resolved_at is null` — so the second delivery finds
                // nothing open rather than closing the row twice.
                open = null;
                return true;
            }
        } as never
    };
}

const dispatcher = { register: () => undefined } as never;

describe('EntryPublishedSubscriber', () => {
    it('subscribes to the one kind that answers a review request', () => {
        const subscriber = new EntryPublishedSubscriber(
            store(null).repository,
            dispatcher
        );

        expect(subscriber.kinds).toEqual(['entry.published']);
    });

    it('registers itself with the dispatcher on bootstrap', () => {
        const registered: unknown[] = [];
        const subscriber = new EntryPublishedSubscriber(
            store(null).repository,
            { register: (entry: unknown) => registered.push(entry) } as never
        );

        subscriber.onApplicationBootstrap();

        expect(registered).toEqual([subscriber]);
    });

    it('closes the open request for the entry that published', async () => {
        const { repository, resolved } = store('request-1');
        const subscriber = new EntryPublishedSubscriber(repository, dispatcher);

        await subscriber.handle(published());

        expect(resolved).toEqual(['request-1']);
    });

    /**
     * Outbox delivery is **at-least-once**, so a dispatcher retry after a
     * partial failure replays this event — and the second delivery must be a
     * no-op rather than a second write or a throw. Nothing about the first
     * delivery makes that true on its own; it is true because `resolve` is
     * conditional and `findOpenByEntry` stops matching once it has run.
     */
    it('does nothing on a second delivery of the same event', async () => {
        const { repository, resolved } = store('request-1');
        const subscriber = new EntryPublishedSubscriber(repository, dispatcher);

        await subscriber.handle(published());
        await expect(subscriber.handle(published())).resolves.toBeUndefined();

        expect(resolved).toEqual(['request-1']);
    });

    it('does nothing for an entry nobody asked about', async () => {
        const { repository, resolved } = store(null);
        const subscriber = new EntryPublishedSubscriber(repository, dispatcher);

        await subscriber.handle(published());

        expect(resolved).toEqual([]);
    });

    it('ignores an event of another kind, and one with no entry', async () => {
        const { repository, resolved } = store('request-1');
        const subscriber = new EntryPublishedSubscriber(repository, dispatcher);

        await subscriber.handle({
            ...published(),
            kind: 'entry.updated'
        } as DomainEvent);
        await subscriber.handle(published(null));

        expect(resolved).toEqual([]);
    });

    /**
     * The failure that must not propagate. `OutboxDispatcher` calls subscribers
     * inside its claim transaction and the publish has already committed by
     * then — so a throw here would retry an event about work that is done,
     * over and over. A stale queue row is the cheaper wrong state, and it is
     * the one this chooses, loudly enough to find in the log.
     */
    it('logs and swallows a store that fails, rather than failing the publish', async () => {
        const warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined);
        const subscriber = new EntryPublishedSubscriber(
            {
                findOpenByEntry: async () => {
                    throw new Error('connection reset');
                },
                resolve: async () => true
            } as never,
            dispatcher
        );

        await expect(subscriber.handle(published())).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('connection reset')
        );
        warn.mockRestore();
    });
});
