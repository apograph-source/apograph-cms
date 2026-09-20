import { buildEnvelope, type WebhookSourceEvent } from './envelope';
import { isAllowedCustomHeader } from './delivery';

const source: WebhookSourceEvent = {
    eventId: '9c41d0f6-0000-4000-8000-000000000001',
    kind: 'entry.published',
    occurredAt: new Date('2026-08-29T10:12:04.881Z'),
    workspaceId: 'b71e0000-0000-4000-8000-000000000002',
    aggregateType: 'content_entry',
    aggregateId: '5ac90000-0000-4000-8000-000000000003',
    data: { contentType: 'article', status: 'published' },
    actor: { id: 'd0a2', email: 'editor@example.com' }
};

describe('buildEnvelope', () => {
    it('carries the delivery id it was given, not one of its own', () => {
        expect(buildEnvelope('delivery-1', source).id).toBe('delivery-1');
    });

    it('keeps the event id stable so a receiver can deduplicate', () => {
        const first = buildEnvelope('delivery-1', source);
        const redelivery = buildEnvelope('delivery-2', source);
        expect(redelivery.eventId).toBe(first.eventId);
        expect(redelivery.id).not.toBe(first.id);
    });

    it('renders the domain time as ISO-8601', () => {
        expect(buildEnvelope('d', source).occurredAt).toBe(
            '2026-08-29T10:12:04.881Z'
        );
    });

    it('names the aggregate under data.kind / data.id', () => {
        expect(buildEnvelope('d', source).data).toEqual({
            kind: 'content_entry',
            id: '5ac90000-0000-4000-8000-000000000003',
            contentType: 'article',
            status: 'published'
        });
    });

    it('cannot have its envelope keys overwritten by payload data', () => {
        const hostile = {
            ...source,
            data: { kind: 'spoofed', id: 'spoofed' }
        };
        const envelope = buildEnvelope('d', hostile);
        expect(envelope.data.kind).toBe('content_entry');
        expect(envelope.data.id).toBe(source.aggregateId);
    });

    it('passes a missing actor through as null rather than inventing one', () => {
        expect(buildEnvelope('d', { ...source, actor: null }).actor).toBeNull();
    });
});

describe('isAllowedCustomHeader', () => {
    it.each(['Authorization', 'X-Tenant', 'x-custom-token'])(
        'allows %p',
        (name) => {
            expect(isAllowedCustomHeader(name)).toBe(true);
        }
    );

    it.each([
        'X-Ortha-Event',
        'x-ortha-signature',
        'Host',
        'Content-Length',
        'content-type',
        'User-Agent',
        '',
        'bad header'
        // covers: webhooks:I-11
    ])('refuses %p', (name) => {
        expect(isAllowedCustomHeader(name)).toBe(false);
    });
});
