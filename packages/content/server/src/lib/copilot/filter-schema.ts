import type { FieldSchema } from '@orthacms/utils-server';
import type { WireFilterField } from '../entries/types/filter-surface';

/**
 * The operators the filter engine accepts, as the model sees them. Mirrors
 * `FilterOperator` in `@orthacms/utils-server` — restated rather than imported
 * so the descriptions can be written *for a model* instead of for a developer.
 */
export const FILTER_OPERATORS = [
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'nin',
    'like',
    'ilike',
    'nilike',
    'null'
] as const;

/**
 * The JSON Schema for a filter tree, handed to the model as
 * `admin_content_search`'s `filter` parameter.
 *
 * The grammar is the query builder's own — a node is either a group
 * (`{and: […]}` / `{or: […]}`) or a rule (`{field, op, value}`) — so the model
 * emits exactly what the admin's UI emits and the same parser validates both.
 * **The model never writes SQL**: `parseFilterTree` checks every path against a
 * schema derived from the content type, so an unknown field or an ungranted
 * relation hop is a rejected filter, not a query.
 *
 * `$ref`/`$defs` are deliberately avoided — a recursive schema is exactly the
 * thing small models handle worst, and our own `validateToolInput` ignores
 * `$ref` anyway. Two literal levels of nesting cover every filter the admin's
 * own query builder can produce, and a deeper one still *works*: the validator
 * only checks what it is given, and the real depth limit is the parser's.
 */
export function filterTreeSchema(): Record<string, unknown> {
    const rule = {
        type: 'object',
        properties: {
            field: {
                type: 'string',
                description:
                    'A filterable path from admin_content_types → filterableFields, e.g. "status" or "author.name".'
            },
            op: {
                type: 'string',
                enum: [...FILTER_OPERATORS],
                description:
                    'like/ilike/nilike match text only — they are rejected on a date, number, boolean or uuid field. Use eq/ne, the ordering operators, or in/nin there.'
            },
            value: {
                description:
                    'The comparison value. An array for in/nin; a boolean for null (true = IS NULL); omitted values are rejected.'
            }
        },
        required: ['field', 'op'],
        additionalProperties: false
    } as const;

    const group = (of: unknown) => ({
        type: 'object',
        properties: {
            and: { type: 'array', items: of },
            or: { type: 'array', items: of }
        },
        additionalProperties: false
    });

    return {
        ...group({ anyOf: [rule, group(rule)] }),
        description:
            'A filter tree. Either a group — {"and":[…]} or {"or":[…]} — or, nested inside one, ' +
            'rules of the form {"field":"status","op":"eq","value":"published"}. ' +
            'Only paths listed by admin_content_types are accepted.'
    };
}

/**
 * Root envelope columns the SQL whitelist accepts but that must NOT be
 * advertised, because each already has a dedicated tool **parameter**.
 *
 * `admin_content_search` takes `locale`, which the bound entry extension
 * validates and scopes with; a model that filtered `locale eq "de"` instead
 * would AND that onto the extension's own scope — already pinned to the
 * default locale — and read zero rows from a perfectly valid query. Offering
 * both spellings of one idea is how a model picks the broken one.
 */
const PARAMETER_BACKED_FIELDS: ReadonlySet<string> = new Set([
    'locale',
    'localeGroupId'
]);

/**
 * The filterable paths, flattened for a model.
 *
 * `WireFilterField` carries a `group` breadcrumb for the admin's picker UI,
 * which is noise here — a model wants the dotted path, the coercion type, and
 * the allowed values for an enum. Trimming it also keeps `admin_content_types`
 * affordable on a type with a wide relation graph.
 *
 * **`wire` alone is the picker's list, which is narrower than what SQL
 * accepts** — and the gap is not cosmetic. `scalarWireOf` pushes `status` and
 * the type's own fields; the envelope timestamps, `publishedAt` above all, are
 * whitelisted for SQL and deliberately kept out of the admin UI. A person does
 * not need `publishedAt` in a picker — they have a **Modified** badge in front
 * of them. A model has no badge, and without this path cannot express
 * "published content with unpublished changes" at all: it falls back to
 * `status eq draft` and counts never-published drafts as edits, or invents
 * `status eq "modified"` and gets an enum error. Both answers are confidently
 * wrong, which is exactly what the filter grammar's "only paths listed by
 * admin_content_types are accepted" is supposed to prevent.
 *
 * So `sqlFields` — the ROOT level of the very `FilterSchema` that is the
 * security boundary — is unioned in. Reading the boundary is the opposite of
 * a second source of truth: a field added to `scalarFieldsOf` later is offered
 * here automatically, with {@link PARAMETER_BACKED_FIELDS} the one stated
 * exception. Relation-level envelope paths (`author.publishedAt`) stay
 * unadvertised: SQL still accepts them, and listing every hop's envelope would
 * cost more prompt than it buys.
 */
export function describeFilterFields(
    fields: readonly WireFilterField[],
    sqlFields?: FieldSchema
): Array<{
    path: string;
    type: string;
    values?: readonly string[];
    relationTo?: string;
}> {
    const described = fields.map((field) => ({
        path: field.path,
        type: field.type as string,
        ...(field.enumValues ? { values: field.enumValues } : {}),
        ...(field.relationTarget ? { relationTo: field.relationTarget } : {})
    }));

    if (!sqlFields) return described;

    const advertised = new Set(described.map((field) => field.path));
    for (const [name, spec] of Object.entries(sqlFields)) {
        if (advertised.has(name) || PARAMETER_BACKED_FIELDS.has(name)) continue;
        described.push({
            path: name,
            type: spec.type as string,
            ...(spec.enumValues ? { values: spec.enumValues } : {})
        });
    }
    return described;
}
