import {
    attachActor,
    createDomainEvent,
    type Database,
    type DomainEvent,
    type EventActor,
    type OutboxDispatcher
} from '@orthacms/database';
import { activityEvents } from '../../schema';
import { AUDITED_EVENT_KINDS } from './audit-event-mapping';
import { AuditEventSubscriber } from './audit-event.subscriber';

/**
 * The subscriber's two structural promises, neither of which the mapping spec
 * can see: what it asks the dispatcher for, and what it does with a kind it was
 * handed anyway.
 *
 * `audit-event-mapping.spec.ts` pins the contents of `AUDITED_EVENT_KINDS` and
 * that every mapper produces a declared kind — but nothing pinned that the
 * subscriber's own `kinds` **is** that list. A subscriber declaring `'*'`
 * (which the `DomainEventSubscriber` contract allows) would pass every one of
 * those assertions while asking the dispatcher for every event in the system.
 *
 * No database: the whole point of `toAuditRow` being pure is that the write
 * path is one `insert().values().onConflictDoNothing()` over a row that was
 * already decided, so a recording fake is enough to see whether a row was
 * written at all.
 */

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AT = new Date('2026-07-17T12:00:00.000Z');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR: EventActor = { id: 'actor-1', email: 'admin@example.com' };

/** An event as a producer builds it: `createDomainEvent` then `attachActor`. */
function event(kind: string, payload: Record<string, unknown>): DomainEvent {
    const [enriched] = attachActor(
        [
            createDomainEvent({
                eventId: EVENT_ID,
                kind,
                aggregateType: 'workspace',
                aggregateId: WORKSPACE_ID,
                occurredAt: AT,
                payload
            })
        ],
        ACTOR
    );
    return enriched;
}

/**
 * A Drizzle stand-in that records the inserts it is asked for and nothing else.
 *
 * Deliberately **not** a no-op: `rows` is what tells "the subscriber declined to
 * write" apart from "the subscriber wrote and the fake swallowed it", which is
 * the only distinction the unmapped-kind test is about.
 */
function recordingDb() {
    const tables: unknown[] = [];
    const rows: Record<string, unknown>[] = [];
    const db = {
        insert(table: unknown) {
            tables.push(table);
            return {
                values(row: Record<string, unknown>) {
                    return {
                        async onConflictDoNothing() {
                            rows.push(row);
                        }
                    };
                }
            };
        }
    };
    return { db: db as unknown as Database, tables, rows };
}

/** A dispatcher stand-in that records what registered with it. */
function recordingDispatcher() {
    const registered: { kinds: readonly string[] | '*' }[] = [];
    const dispatcher = {
        register(subscriber: { kinds: readonly string[] | '*' }) {
            registered.push(subscriber);
        }
    };
    return {
        dispatcher: dispatcher as unknown as OutboxDispatcher,
        registered
    };
}

describe('AuditEventSubscriber', () => {
    describe('what it asks the dispatcher for', () => {
        it('accepts exactly the kinds the mapper table lists, not a wildcard [activity:I-09]', () => {
            const { db } = recordingDb();
            const { dispatcher } = recordingDispatcher();
            const subscriber = new AuditEventSubscriber(db, dispatcher);

            // `'*'` is a legal value of the contract's `kinds`, and it is the
            // shape this assertion exists to refuse: a wildcard subscriber
            // would be handed every event in the deployment and would decide
            // what to audit by silently returning from `handle`, which is a
            // very different (and unreviewable) allow-list.
            expect(subscriber.kinds).not.toBe('*');
            expect([...subscriber.kinds]).toEqual([...AUDITED_EVENT_KINDS]);
        });

        it('registers itself, so those kinds are the delivery allow-list [activity:I-09]', () => {
            const { db } = recordingDb();
            const { dispatcher, registered } = recordingDispatcher();
            const subscriber = new AuditEventSubscriber(db, dispatcher);

            subscriber.onApplicationBootstrap();

            // The list above only bounds delivery because *this* object is what
            // reaches the dispatcher. Registering something else — or nothing —
            // leaves `kinds` a correct but inert declaration.
            expect(registered).toHaveLength(1);
            expect(registered[0]).toBe(subscriber);
            expect([...registered[0].kinds]).toEqual([...AUDITED_EVENT_KINDS]);
        });
    });

    describe('an event of a kind no mapper claims', () => {
        it('writes nothing and raises nothing [activity:I-10]', async () => {
            const { db, rows } = recordingDb();
            const { dispatcher } = recordingDispatcher();
            const subscriber = new AuditEventSubscriber(db, dispatcher);

            // Resolving is what the dispatcher reads as "delivered" — it stamps
            // `dispatched_at` on a handler that returns and parks the row on one
            // that throws. So the absence of a rejection here *is* the "stamped
            // delivered" half, seen from this side of the seam.
            await expect(
                subscriber.handle(
                    event('workspace.something_else', { name: 'nope' })
                )
            ).resolves.toBeUndefined();

            expect(rows).toEqual([]);
        });

        it('is told apart from an audited kind, which does reach the log [activity:I-10]', async () => {
            const { db, tables, rows } = recordingDb();
            const { dispatcher } = recordingDispatcher();
            const subscriber = new AuditEventSubscriber(db, dispatcher);

            // The complement, in the same fixture and through the same fake: if
            // this wrote nothing either, the test above would be measuring a
            // broken harness rather than a mapper that declined.
            await subscriber.handle(
                event('workspace.created', { name: 'Docs', slug: 'docs' })
            );

            expect(tables).toEqual([activityEvents]);
            expect(rows).toEqual([
                {
                    id: EVENT_ID,
                    kind: 'workspace.created',
                    subjectType: 'workspace',
                    subjectId: WORKSPACE_ID,
                    actorId: ACTOR.id,
                    actorType: 'user',
                    actorEmail: ACTOR.email,
                    workspaceId: null,
                    meta: { name: 'Docs', slug: 'docs' },
                    at: AT
                }
            ]);
        });
    });
});
