import { defineMessages } from 'react-intl';
import {
    FIELD_TYPE,
    OP,
    type FilterField
} from '@orthacms/query-builder-admin';
import type { ContentTypeDetail } from '@orthacms/content-admin';

const messages = defineMessages({
    reviewState: {
        id: 'protection.filter.reviewState',
        defaultMessage: 'Review'
    },
    awaiting: {
        id: 'protection.filter.awaiting',
        defaultMessage: 'Waiting on review'
    },
    notRequested: {
        id: 'protection.filter.notRequested',
        defaultMessage: 'Not requested'
    }
});

/** The wire name the server's filter provider declares. */
export const REVIEW_STATE_FILTER_FIELD = 'reviewState';

/**
 * The **Review** field in the records query-builder drawer.
 *
 * Contributed through `RECORDS_FILTER_FIELDS_SLOT`, which is what makes saved
 * views and alarms' "Save as rule" work over review state with no code of their
 * own: a saved view is the records URL, a rule is the records filter tree, and
 * this field is in both the moment it is in the picker.
 *
 * **The operator set is the subquery's, not a column's.** The server answers
 * `eq` and `in` and refuses the rest, and an operator the resolver refuses
 * reaches the user as "couldn't load this collection" over a rule the drawer
 * itself proposed — so the two lists are narrowed together or not at all.
 *
 * Negation is absent for the same reason it is absent from i18n's fields: `ne`
 * would negate *inside* the EXISTS, asking "has some open request that is not
 * this one", which is not the question anybody means. "Not waiting" is its own
 * value here, so the honest spelling is already in the enum.
 *
 * Empty on a **non-publishable** type: review guards the `draft → published`
 * transition, and offering a filter a type can never satisfy is a rule the
 * picker proposes and the list then answers with nothing.
 */
export function useReviewStateFilterFields(
    schema: ContentTypeDetail
): FilterField[] {
    if (!schema.publishable) return [];
    return [
        {
            id: REVIEW_STATE_FILTER_FIELD,
            label: messages.reviewState,
            type: FIELD_TYPE.Enum,
            operators: [OP.Equals, OP.IsOneOf],
            enumValues: [
                {
                    value: 'awaiting',
                    label: messages.awaiting
                },
                {
                    value: 'not_requested',
                    label: messages.notRequested
                }
            ]
        }
    ];
}
