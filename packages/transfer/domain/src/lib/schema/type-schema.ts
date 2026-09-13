/**
 * The minimal, structural view of a content type that transfer needs.
 *
 * Deliberately *structural* rather than imported: `content-server`'s
 * `SerializedContentType` and `content-admin`'s `ContentTypeDetail` are both
 * assignable to it, so both runtimes feed this kernel without an adapter and
 * without this package depending on either. The same trick `content-domain`'s
 * `EntryFieldSpec` plays.
 */

/** One field, as far as export and import care. */
export interface TransferFieldSchema {
    name: string;
    /** A `CONTENT_FIELD_TYPE` value. */
    type: string;
    required: boolean;
    /** Value differs per locale — only meaningful on an `i18n` type. */
    localized?: boolean;
    /** Allowed values (select / multiselect). */
    options?: readonly string[];
    /** Relation config — relation fields only. */
    relation?: {
        to: string;
        many: boolean;
        unique?: boolean;
        /** Present when this field is the inverse side of a two-way relation. */
        inverse?: { field: string };
    };
    /** Holds an ordered list of asset ids — media fields only. */
    multiple?: boolean;
}

/** One content type, as far as export and import care. */
export interface TransferTypeSchema {
    name: string;
    publishable: boolean;
    paranoid: boolean;
    i18n: boolean;
    fields: readonly TransferFieldSchema[];
}

/** Every type in play for one transfer, keyed by type name. */
export type TransferSchemas = Record<string, TransferTypeSchema>;

/** Looks a field up by name. */
export function fieldOf(
    schema: TransferTypeSchema,
    name: string
): TransferFieldSchema | undefined {
    return schema.fields.find((field) => field.name === name);
}

/**
 * Relation fields that own their storage.
 *
 * The inverse side is excluded on purpose: it is the *same* link read from the
 * other end, so walking both would export every edge twice and — worse — let an
 * import write the same link from two directions with two different orderings.
 * A two-way relation has one owner, and the owner's order is the order.
 */
export function owningRelationFields(
    schema: TransferTypeSchema
): TransferFieldSchema[] {
    return schema.fields.filter(
        (field) => field.relation && !field.relation.inverse
    );
}

/** Media fields of a type. */
export function mediaFields(schema: TransferTypeSchema): TransferFieldSchema[] {
    return schema.fields.filter((field) => field.type === 'media');
}
