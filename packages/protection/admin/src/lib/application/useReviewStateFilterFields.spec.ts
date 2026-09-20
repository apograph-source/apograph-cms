import { OP } from '@orthacms/query-builder-admin';
import {
    REVIEW_STATE_FILTER_FIELD,
    useReviewStateFilterFields
} from './useReviewStateFilterFields';

/** A content type as the schema endpoint returns one. */
const schema = (publishable: boolean) =>
    ({ name: 'article', publishable }) as never;

describe('the reviewState filter field', () => {
    it('offers both states on a publishable type', () => {
        const [field] = useReviewStateFilterFields(schema(true));

        expect(field.id).toBe(REVIEW_STATE_FILTER_FIELD);
        expect(field.enumValues?.map((value) => value.value)).toEqual([
            'awaiting',
            'not_requested'
        ]);
    });

    /**
     * Review guards the `draft → published` transition, so a type that is always
     * live has none to hold — and offering the field there would put a rule in
     * the drawer that the list then answers with nothing.
     */
    it('offers nothing on a non-publishable type', () => {
        expect(useReviewStateFilterFields(schema(false))).toEqual([]);
    });

    /**
     * The operator set has to match what the server's resolver answers. One it
     * refuses reaches the person as "couldn't load this collection" over a rule
     * the drawer itself proposed — so the two lists move together, and this is
     * what notices when only one of them does.
     *
     * Negation in particular is absent by design rather than by omission: `ne`
     * would negate *inside* the EXISTS, and "not waiting" is already its own
     * value in the enum.
     */
    it('declares only the operators the server answers', () => {
        const [field] = useReviewStateFilterFields(schema(true));

        expect(field.operators).toEqual([OP.Equals, OP.IsOneOf]);
        expect(field.operators).not.toContain(OP.NotEquals);
        expect(field.operators).not.toContain(OP.NotOneOf);
    });
});
