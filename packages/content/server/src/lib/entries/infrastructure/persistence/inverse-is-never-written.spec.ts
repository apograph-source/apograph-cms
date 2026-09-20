import { collection } from '../../../collection/define';
import { field } from '../../../fields';
import type { AnyContentType } from '../../../types/content-type';
import { toColumns } from './entry-row';
import { RelationLinkService } from './relation-link.service';
import type { Database } from '@orthacms/database';

/**
 * **The import half of `transfer:I-05`** — "the inverse side of a two-way
 * relation ... is not written on import".
 *
 * The export half is pinned in `apps/server-e2e` (the document carries no
 * inverse field) and the CSV half in `@orthacms/transfer-domain`
 * (`flatten.spec.ts` — no column is written, and one on a hand-made sheet is
 * not read back). Neither reaches the write path, and a **JSON** document is
 * not written by this system: it can be hand-edited, or produced by another
 * tool, and its `relations` bag is passed to `EntryWriterService` verbatim —
 * `ImportEntriesUseCase` resolves references without consulting the schema, on
 * purpose, because the writer is the one place the rules are enforced.
 *
 * So the guarantee is exactly these two filters, and this is where they are
 * pinned. Both are reached with the relation submitted **as a plain value**,
 * which is how the importer submits every relation (the `relations` delta path
 * is the editor's).
 *
 * Why it matters: an inverse field is the *same* link read from the other end.
 * Writing it would set the link from the side that owns no storage and no
 * order — and "the owner's order is the order" is the second sentence of the
 * same invariant. A document round-tripped through another tool would come back
 * with its many-relations silently reordered.
 */

/** The owning side of a two-way relation, plus the inverse that reads it back. */
const tag = collection('inverse_spec_tag', { fields: { name: field.text() } });

const article: AnyContentType = collection('inverse_spec_article', {
    fields: {
        title: field.text(),
        // The owning side: its links live in this type's join table.
        tags: field.relation({ to: () => tag, many: true }),
        // The inverse: the same edge, read from the other end. Owns nothing.
        related: field.relationInverse({
            of: (): AnyContentType => article,
            field: 'tags'
        }),
        // A **single-cardinality** inverse. It is the one that isolates the
        // `inverse` clause of `toColumns`'s filter: the `many` inverse above is
        // already excluded by the `many` half, so a fixture holding only that
        // one would pass with the inverse rule deleted.
        backRef: field.relationInverse({
            of: (): AnyContentType => article,
            field: 'tags',
            many: false
        })
    }
}) as AnyContentType;

const TARGETS = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
];

describe('an inverse relation submitted as a value', () => {
    it('becomes no column on the row [transfer:I-05]', () => {
        const columns = toColumns(article, {
            title: 'Hello',
            tags: TARGETS,
            related: TARGETS,
            backRef: TARGETS[0]
        });

        expect(columns).not.toHaveProperty('related');
        expect(columns).not.toHaveProperty('backRef');
        // The controls, from the same call: a scalar landed, so the projection
        // ran; and the *owning* many-relation is absent for its own reason
        // (its links live in a join table), so "absent" here is not the whole
        // relation family being dropped.
        expect(columns['title']).toBe('Hello');
        expect(columns).not.toHaveProperty('tags');
    });

    it('reaches no join table either [transfer:I-05]', async () => {
        // A transaction that refuses to be used. The claim is that the inverse
        // field is skipped *before* any statement is built, so anything the
        // service touched here would be a write.
        const forbidden = new Proxy(
            {},
            {
                get(_target, property) {
                    throw new Error(
                        `writeLinks reached tx.${String(property)} for an ` +
                            'inverse relation'
                    );
                }
            }
        );
        const service = new RelationLinkService({} as Database);

        await expect(
            service.writeLinks(
                forbidden as never,
                article,
                'source-1',
                { related: TARGETS },
                'workspace-1'
            )
        ).resolves.toBeUndefined();
    });

    it('is the owning side that does reach it [transfer:I-05]', async () => {
        // The control the case above depends on. Without it, a `writeLinks`
        // that had stopped writing anything at all — or a fixture whose join
        // plan resolved to nothing — would pass by touching no transaction for
        // any field, and the inverse rule would be proving nothing.
        const touched: string[] = [];
        const tx = new Proxy(
            {},
            {
                get(_target, property) {
                    touched.push(String(property));
                    throw new Error('stop');
                }
            }
        );
        const service = new RelationLinkService({} as Database);

        await expect(
            service.writeLinks(
                tx as never,
                article,
                'source-1',
                { tags: TARGETS },
                'workspace-1'
            )
        ).rejects.toThrow('stop');

        expect(touched.length).toBeGreaterThan(0);
    });
});
