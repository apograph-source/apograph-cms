import { isRule, OP } from '../types/filter-tree.type';
import { jsonFilterToTree } from './jsonFilterToTree';

/** Ids are React keys, not data — pinned so a tree is comparable. */
let seq = 0;
const ids = () => `id-${++seq}`;
beforeEach(() => {
    seq = 0;
});

/**
 * The deserialiser on the operators the **server** accepts.
 *
 * Its documented contract is that it drops what it does not recognise, and the
 * cases that exercise that live in `admin-e2e`'s hand-edited `?filter=` suite.
 * This file covers the other side of the same table: an operator that is not
 * junk, that a link may legitimately carry, and that must therefore survive.
 */
describe('jsonFilterToTree — operators the server accepts', () => {
    /**
     * `like` is the case-sensitive half of the `~~` family. `parseFilterTree`
     * accepts it on every text field (`PATTERN_OPERATORS` in
     * `@orthacms/utils-server`), and the list pages send the **raw** `?filter=`
     * param to the API — so a link carrying it filters the table correctly
     * while the builder above the table showed nothing at all.
     *
     * That is the failure this pins. The rule did not merely render oddly, it
     * *disappeared*: the chips said nothing, "Filters (N)" counted it out, and
     * the next Apply — or the next chip anybody removed — re-serialised the
     * tree without it and silently widened the filter the link had asked for.
     *
     * It rehydrates as `contains`, which is a deliberate and **visible**
     * downgrade: the UI offers no case-sensitive substring operator, so the
     * round trip comes back as `ilike`. The same lossy-but-preferred
     * rehydration the file already makes for `gte`+`lte` → Between. Widening
     * one operator while saying so on screen is not the same failure as losing
     * the condition with no trace.
     */
    it('rehydrates a "like" rule instead of dropping it', () => {
        const tree = jsonFilterToTree(
            JSON.stringify({ field: 'title', op: 'like', value: '%Ada%' }),
            ids
        );

        expect(tree?.children).toHaveLength(1);
        const [node] = tree?.children ?? [];
        expect(node && isRule(node) && node).toMatchObject({
            fieldId: 'title',
            op: OP.Contains,
            // Unwrapped and unescaped, so the editor shows what was searched
            // for rather than the LIKE pattern it was wrapped in.
            value: 'Ada'
        });
    });

    it('keeps a "like" rule when it is one of several', () => {
        // The sharper shape: dropping the leaf left the *rest* of the filter
        // looking complete, so nothing on screen suggested a condition had gone
        // missing.
        const tree = jsonFilterToTree(
            JSON.stringify({
                and: [
                    { field: 'title', op: 'like', value: '%Ada%' },
                    { field: 'slug', op: 'eq', value: 'ada' }
                ]
            }),
            ids
        );

        expect(tree?.children).toHaveLength(2);
    });

    it('still drops an operator the server does not accept either', () => {
        // The tolerance contract is unchanged: this widens the table by exactly
        // one real operator, not into "anything goes".
        expect(
            jsonFilterToTree(
                JSON.stringify({
                    field: 'title',
                    op: 'starts_with',
                    value: 'Ada'
                }),
                ids
            )
        ).toBeNull();
    });
});
