import { ENTRY_STATUS } from '@orthacms/content-domain';
import { Entry } from './entry';
import { EntryPublishBlockedError } from './entry-publish-blocked.error';
import { ENTRY_EVENT_KINDS } from './events/entry-events';

const rehydrate = (status: 'draft' | 'published') =>
    Entry.rehydrate({ id: 'e1', contentType: 'post', status });

const okGate = { valid: true, issues: [] };

describe('Entry publish lifecycle', () => {
    it('publishes a valid draft and raises entry.published', () => {
        const entry = rehydrate(ENTRY_STATUS.Draft);
        entry.publish(okGate);
        expect(entry.status).toBe(ENTRY_STATUS.Published);
        const events = entry.pullEvents();
        expect(events.map((e) => e.kind)).toEqual([
            ENTRY_EVENT_KINDS.PUBLISHED
        ]);
        expect(events[0].aggregateId).toBe('e1');
        // The subject fields ride on every entry event: `workspaceId` fills the
        // audit row's column, `title` is the frozen label that keeps the row
        // readable after the entry is gone. Both are null here because this
        // rehydrate names neither.
        expect(events[0].payload).toEqual({
            contentType: 'post',
            workspaceId: null,
            title: null
        });
    });

    it('blocks publish with the issues when the gate fails', () => {
        const entry = rehydrate(ENTRY_STATUS.Draft);
        const issues = [{ field: 'title', message: 'is required' }];
        try {
            entry.publish({ valid: false, issues });
            throw new Error('expected a throw');
        } catch (error) {
            expect(error).toBeInstanceOf(EntryPublishBlockedError);
            expect((error as EntryPublishBlockedError).issues).toEqual(issues);
        }
        expect(entry.status).toBe(ENTRY_STATUS.Draft);
        expect(entry.pullEvents()).toEqual([]);
    });

    it('is an idempotent no-event re-publish when already published', () => {
        const entry = rehydrate(ENTRY_STATUS.Published);
        entry.publish(okGate);
        expect(entry.status).toBe(ENTRY_STATUS.Published);
        expect(entry.pullEvents()).toEqual([]);
    });

    it('blocks an already-published row whose stored values went invalid', () => {
        const entry = rehydrate(ENTRY_STATUS.Published);
        expect(() =>
            entry.publish({
                valid: false,
                issues: [{ field: 'title', message: 'is required' }]
            })
        ).toThrow(EntryPublishBlockedError);
    });

    it('unpublishes a published entry and raises entry.unpublished', () => {
        const entry = rehydrate(ENTRY_STATUS.Published);
        entry.unpublish();
        expect(entry.status).toBe(ENTRY_STATUS.Draft);
        expect(entry.pullEvents().map((e) => e.kind)).toEqual([
            ENTRY_EVENT_KINDS.UNPUBLISHED
        ]);
    });

    it('is an idempotent no-event unpublish when already a draft', () => {
        const entry = rehydrate(ENTRY_STATUS.Draft);
        entry.unpublish();
        expect(entry.status).toBe(ENTRY_STATUS.Draft);
        expect(entry.pullEvents()).toEqual([]);
    });
});
