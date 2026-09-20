import {
    ScalarFieldType,
    type ScalarFieldSchema
} from '@orthacms/utils-server';
import { CONTENT_FIELD_TYPE, type AnyFieldSpec } from '../../../types/fields';

/**
 * The filter scalar type for one content field, or `null` to leave it
 * unfilterable. Mirrors the admin's `filterFieldsFromSchema`: text fields
 * filter as strings, `select` as an enum of its options, numerics as numbers,
 * dates as dates. `json`/`multiselect`/`media` have no scalar editor, and
 * `relation` filtering (by raw FK uuid) has no UI yet — all skipped.
 *
 * `richtext` is skipped too, and deliberately: a body is a **document**, so
 * `equals`/`starts with` over it would be comparing one serialization of a
 * node tree against another rather than comparing prose. Free-text `?search=`
 * still reaches it — see `isTextLike` — which is the question a reader
 * actually asks of a body.
 */
export function scalarTypeFor(spec: AnyFieldSpec): ScalarFieldSchema | null {
    switch (spec.type) {
        case CONTENT_FIELD_TYPE.Text:
            return { type: ScalarFieldType.String };
        case CONTENT_FIELD_TYPE.Select:
            return {
                type: ScalarFieldType.Enum,
                enumValues: spec.options ?? []
            };
        case CONTENT_FIELD_TYPE.Number:
        case CONTENT_FIELD_TYPE.Money:
            return { type: ScalarFieldType.Number };
        case CONTENT_FIELD_TYPE.Boolean:
            return { type: ScalarFieldType.Boolean };
        case CONTENT_FIELD_TYPE.Date:
        case CONTENT_FIELD_TYPE.Datetime:
            return { type: ScalarFieldType.Date };
        default:
            // richtext / json / multiselect / media / relation
            return null;
    }
}

/**
 * Whether a field is backed by a comparable scalar column — the single source of
 * truth for "can this field be filtered or sorted". `richtext`/`json`/
 * `multiselect` (jsonb) and `relation` (FK uuid / join table) are not: they have
 * no scalar editor and ordering them is meaningless. The sort whitelist and the filter schema both
 * derive from this, so the two can't drift apart.
 */
export function isScalarField(spec: AnyFieldSpec): boolean {
    return scalarTypeFor(spec) !== null;
}
