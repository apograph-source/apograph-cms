import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { ContentReadScopeContext } from '@orthacms/content-server';
import { SegmentCatalogService } from '../application/segment-catalog.service';
import { ReaderStore } from '../application/reader.store';
import { SegmentReadScope } from './segment-read-scope';

/** A stand-in content table with the `id` column every real one has. */
const articles = pgTable('articles', {
    id: uuid('id').primaryKey(),
    title: text('title')
});

/** The scope's context for that table. */
const context = {
    type: { name: 'article', table: articles },
    workspaceId: 'w1'
} as unknown as ContentReadScopeContext;

/** A catalogue reporting whether anything is configured. */
function catalogue(configured: boolean): SegmentCatalogService {
    return { configured } as unknown as SegmentCatalogService;
}

/** A reader store holding the given segment ids. */
function readerWith(ids: string[]): ReaderStore {
    const store = new ReaderStore();
    jest.spyOn(store, 'current').mockReturnValue({
        tags: [],
        segmentIds: new Set(ids)
    });
    return store;
}

/** The emitted fragment as one whitespace-collapsed line. */
function sqlOf(scope: SegmentReadScope): string {
    const fragment = scope.scope(context);
    if (!fragment) throw new Error('expected a fragment');
    // `queryChunks` holds the literal SQL pieces; joining them is enough to
    // assert the *shape* without standing up a dialect.
    return (fragment as unknown as { queryChunks: unknown[] }).queryChunks
        .map((chunk) =>
            typeof chunk === 'object' && chunk !== null && 'value' in chunk
                ? (chunk as { value: string[] }).value.join('')
                : ''
        )
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

describe('SegmentReadScope', () => {
    /**
     * The property that makes installing the plugin a no-op. With no segment
     * defined, no fragment is emitted and a public read is byte-for-byte what
     * it was before — which is the state every existing installation is in.
     */
    it('emits nothing at all when no segment exists', () => {
        const scope = new SegmentReadScope(catalogue(false), readerWith([]));
        expect(scope.scope(context)).toBeUndefined();
    });

    it('defaults an entry with no row to visible [segments:I-02]', () => {
        const scope = new SegmentReadScope(catalogue(true), readerWith([]));
        // `COALESCE(…, true)` is the half that keeps an unrestricted entry —
        // every entry, until somebody decides otherwise — readable.
        expect(sqlOf(scope)).toContain('COALESCE(');
        expect(sqlOf(scope)).toContain(', true)');
    });

    it('checks the deny list, then the empty-allow case, then the intersection [segments:I-06]', () => {
        const scope = new SegmentReadScope(catalogue(true), readerWith(['s1']));
        const sql = sqlOf(scope);
        // The same three rules `canRead` states, in the same order.
        expect(sql).toContain('NOT (');
        expect(sql).toContain('cardinality(');
        expect(sql).toContain('= 0 OR');
        expect(sql).toMatch(/&&/);
    });

    it('scopes the subquery to the entry being read', () => {
        const scope = new SegmentReadScope(catalogue(true), readerWith(['s1']));
        expect(sqlOf(scope)).toContain('FROM');
        expect(sqlOf(scope)).toContain('WHERE');
    });

    /**
     * A content type with no `id` cannot be matched against the access table,
     * and skipping the fragment for it would serve restricted content. Loud
     * beats silent.
     */
    it('throws rather than silently skipping a table with no id [segments:I-39]', () => {
        const idless = {
            type: {
                name: 'odd',
                table: pgTable('odd', { name: text('name') })
            },
            workspaceId: 'w1'
        } as unknown as ContentReadScopeContext;
        const scope = new SegmentReadScope(catalogue(true), readerWith([]));
        expect(() => scope.scope(idless)).toThrow(/has no "id" column/);
    });
});
