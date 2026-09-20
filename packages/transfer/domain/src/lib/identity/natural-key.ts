/**
 * **Natural keys** — how a record keeps its identity across installations.
 *
 * A row id is a fact about one database. Carry it to another installation and
 * it names nothing, so an import that matched on ids could only ever create.
 * What survives the trip is a value an editor would recognise as *the* name of
 * the thing: a slug, an email, an SKU. Deriving that, per type, is the whole of
 * this file, and everything import does downstream rests on it.
 */

import { CONTENT_FIELD_TYPE } from '@orthacms/content-domain';
import type { TransferTypeSchema } from '../schema/type-schema';

/** Where a type's identity fields came from. */
export const IDENTITY_SOURCE = {
    /** Named in the plugin's `identity` config. */
    Configured: 'configured',
    /** The type's first unique single relation-free field. */
    UniqueField: 'unique-field',
    /** The first required text-ish field. */
    RequiredText: 'required-text',
    /** Nothing usable — matching falls back to the source row id. */
    RowId: 'row-id'
} as const;

/** Where a type's identity fields came from. */
export type IdentitySource =
    (typeof IDENTITY_SOURCE)[keyof typeof IDENTITY_SOURCE];

/** A type's resolved identity: which fields key it, and why those. */
export interface IdentityResolution {
    /** Field names making up the key, in order. Empty for {@link IDENTITY_SOURCE.RowId}. */
    fields: string[];
    /** How the fields were chosen — surfaced in the UI so the rule isn't a secret. */
    source: IdentitySource;
}

/** Field types whose value can stand in as a human-recognisable key. */
const KEYABLE_TYPES: readonly string[] = [
    CONTENT_FIELD_TYPE.Text,
    CONTENT_FIELD_TYPE.Select,
    CONTENT_FIELD_TYPE.Number,
    CONTENT_FIELD_TYPE.Money,
    CONTENT_FIELD_TYPE.Date,
    CONTENT_FIELD_TYPE.Datetime
];

/**
 * Decides which fields identify a record of this type.
 *
 * A **configured** list wins outright, including when it names a field the
 * schema no longer has — that is a misconfiguration worth surfacing as an
 * unresolvable key rather than silently papering over with a guess.
 *
 * A `localized` field **is** a candidate, and that is deliberate. A transfer
 * record is one *row*, not one record-across-languages: the English and German
 * versions of an article travel as two records and are stitched back into one
 * by their locale group. So a per-locale slug identifies exactly the row it
 * belongs to, which is what an import needs to match. What keeps `en`/`hello`
 * from colliding with `de`/`hello` is that the locale is part of the match
 * (see `keyFingerprint`), not the exclusion of the field.
 *
 * Excluding localized fields instead would leave a fully-localized type — where
 * every text field varies per language, which is the normal shape — with no key
 * at all, so every import of it would duplicate every row.
 */
export function resolveIdentityFields(
    schema: TransferTypeSchema,
    configured?: readonly string[]
): IdentityResolution {
    if (configured && configured.length > 0) {
        return {
            fields: [...configured],
            source: IDENTITY_SOURCE.Configured
        };
    }

    const candidates = schema.fields.filter((field) =>
        KEYABLE_TYPES.includes(field.type)
    );

    const unique = candidates.find(
        (field) => field.relation?.unique === true || isSlugLike(field.name)
    );
    if (unique) {
        return {
            fields: [unique.name],
            source: IDENTITY_SOURCE.UniqueField
        };
    }

    const required = candidates.find(
        (field) => field.required && field.type === CONTENT_FIELD_TYPE.Text
    );
    if (required) {
        return {
            fields: [required.name],
            source: IDENTITY_SOURCE.RequiredText
        };
    }

    return { fields: [], source: IDENTITY_SOURCE.RowId };
}

/**
 * Whether a field name reads as an identifier by convention.
 *
 * The schema has no `unique` flag for a plain scalar column — only relations
 * carry one — so without this heuristic a collection whose obvious key is
 * `slug` would fall through to "first required text", which is usually the
 * title. Two posts may legitimately share a title; two may not share a slug.
 * Naming remains overridable by config, which is what the escape hatch is for.
 */
function isSlugLike(name: string): boolean {
    const normalized = name.toLowerCase();
    return (
        normalized === 'slug' ||
        normalized === 'key' ||
        normalized === 'code' ||
        normalized === 'sku' ||
        normalized === 'email' ||
        normalized === 'handle' ||
        normalized === 'identifier'
    );
}

/**
 * Reads a record's natural key out of its values.
 *
 * A field with no usable value is **omitted** rather than written as an empty
 * string, so `isCompleteKey` can tell "this record has no key" from "this
 * record's key is the empty string" — the difference between falling back to
 * create and matching every other keyless record in the target.
 */
export function naturalKeyOf(
    fields: readonly string[],
    values: Record<string, unknown>
): Record<string, string> {
    const key: Record<string, string> = {};
    for (const field of fields) {
        const value = values[field];
        const text = keyValueToString(value);
        if (text !== undefined) key[field] = text;
    }
    return key;
}

/**
 * Renders one key value as the string the key is matched on.
 *
 * Dates go through ISO rather than `toString()`, which is locale- and
 * timezone-dependent — a key that changes with the server's timezone matches
 * nothing on the next import.
 */
function keyValueToString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.length > 0 ? value : undefined;
    if (typeof value === 'number')
        return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === 'boolean') return String(value);
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    return undefined;
}
