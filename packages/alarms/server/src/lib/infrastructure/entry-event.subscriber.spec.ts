import type { DomainEvent } from '@apograph/database';
import { EntryEventSubscriber } from './entry-event.subscriber';

/**
 * How one entry event is routed — and in particular the one distinction the
 * server-e2e suite cannot draw.
 *
 * `entry.deleted` **resolves** an entry's findings and `entry.purged`
 * **deletes** them, and through the findings API the two look identical: either
 * way the finding stops appearing in the default list. The difference only
 * shows up on a restore, months later, when the history that `firstSeenAt`
 * carries is either still there or is not. Here the two store methods are
 * distinct calls, so "a soft delete is reversible, a purge is not" is a claim
 * about which one was made rather than about what a list happens to omit.
 */

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ENTRY = '33333333-3333-4333-8333-333333333333';

function event(
    kind: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return {
        eventId: 'event-1',
        kind,
        aggregateType: 'entry',
        aggregateId: ENTRY,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { contentType: 'article', workspaceId: WORKSPACE, ...payload }
    };
}

function subscriber() {
    const findings = {
        resolveForEntry: jest.fn(async () => undefined),
        deleteForEntry: jest.fn(async () => undefined)
    };
    const evaluator = {
        evaluateEntries: jest.fn(async () => undefined),
        evaluateDependents: jest.fn(async () => undefined)
    };
    const dispatcher = { register: jest.fn() };
    const matches = { workspaceOf: jest.fn(async () => WORKSPACE) };
    const registry = { get: () => ({ name: 'article', fields: {} }) };

    return {
        instance: new EntryEventSubscriber(
            dispatcher as never,
            evaluator as never,
            findings as never,
            matches as never,
            registry as never
        ),
        findings,
        evaluator,
        dispatcher
    };
}

describe('EntryEventSubscriber', () => {
    it('closes an entry’s findings on a delete and removes them on a purge [alarms:I-12]', async () => {
        const soft = subscriber();
        await soft.instance.handle(event('entry.deleted'));

        // Reversible: the rows stay, carrying the history a restore brings
        // back with them.
        expect(soft.findings.resolveForEntry).toHaveBeenCalledWith(ENTRY);
        expect(soft.findings.deleteForEntry).not.toHaveBeenCalled();

        const hard = subscriber();
        await hard.instance.handle(event('entry.purged'));

        // Not reversible: the row is gone from its content table, so there is
        // nothing left for a finding to point at.
        expect(hard.findings.deleteForEntry).toHaveBeenCalledWith(ENTRY);
        expect(hard.findings.resolveForEntry).not.toHaveBeenCalled();
    });

    it('evaluates nothing for a purged entry — there is no row left to match', async () => {
        const harness = subscriber();

        await harness.instance.handle(event('entry.purged'));

        expect(harness.evaluator.evaluateEntries).not.toHaveBeenCalled();
        expect(harness.evaluator.evaluateDependents).not.toHaveBeenCalled();
    });

    it('still runs the reverse pass for a deleted entry', async () => {
        const harness = subscriber();

        await harness.instance.handle(event('entry.deleted'));

        // Deleting an author is one of the events that changes what the
        // articles pointing at it mean, so the records that link to it have to
        // be re-evaluated even though this entry's own findings just closed.
        expect(harness.evaluator.evaluateDependents).toHaveBeenCalledWith(
            WORKSPACE,
            'article',
            ENTRY
        );
    });

    it('ignores an event carrying no content type', async () => {
        const harness = subscriber();

        await harness.instance.handle({
            ...event('entry.updated'),
            payload: { workspaceId: WORKSPACE }
        });

        expect(harness.evaluator.evaluateEntries).not.toHaveBeenCalled();
        expect(harness.findings.resolveForEntry).not.toHaveBeenCalled();
    });
});
