import type { ScalarFieldType } from '@orthacms/utils-server';

/**
 * One filterable path offered to the admin's query builder, produced by
 * `buildEntryFilterSurface`. Flat and dotted (`author.name`) — the same
 * string the query-builder puts on the wire as a rule's `field`, walked
 * segment-by-segment by `parseFilterTree` against the sibling
 * `FilterSchema`. The two are built in one traversal so they cannot drift.
 */
export interface WireFilterField {
    /** Dotted path — `author.name`. Serialised verbatim as a rule `field`. */
    path: string;
    /** Human label for the leaf segment (the relation label for an `id` picker). */
    label: string;
    /** Coercion type; matches the admin's `FIELD_TYPE`. */
    type: ScalarFieldType;
    /** Allowed values — present only for `enum`. */
    enumValues?: readonly string[];
    /**
     * Breadcrumb of relation labels, root-first — `['Author']` for
     * `author.name`, `['Author','Company']` for `author.company.name`.
     * Empty for a root field. Groups the field picker; never serialised.
     */
    group: readonly string[];
    /**
     * For a relation's own `id` field: the target content type name. Tells
     * the admin to render a record picker instead of a raw uuid input.
     * `author.id` → `'author'`.
     */
    relationTarget?: string;
}

/** Response body of `GET /content-schema/:name/filter-fields`. */
export interface FilterFieldsResponse {
    fields: WireFilterField[];
}
