import type { MessageDescriptor } from 'react-intl';
import {
    FIELD_TYPE,
    type FieldType,
    type FilterField
} from '@orthacms/query-builder-admin';
import type {
    ContentType,
    ContentTypeSummaryResponse,
    FilterFieldType,
    WireFilterField
} from '../../domain/types/contentType';

/**
 * The content plugin's anti-corruption layer: maps the wire shapes served by the
 * content API to the admin's models. Content's wire and view shapes are largely
 * congruent (fields pass through untouched), so this is deliberately thin — one
 * summary mapper — but it keeps the seam explicit and in one place.
 */

/** Maps one wire type summary to the admin `ContentType` model. */
export function toContentType(
    summary: ContentTypeSummaryResponse
): ContentType {
    return {
        name: summary.name,
        kind: summary.kind,
        label: summary.label,
        description: summary.description,
        path: summary.path,
        publishable: summary.publishable,
        paranoid: summary.paranoid
    };
}

/** Wire coercion type → the query-builder's UI field type (identity map). */
const FIELD_TYPE_BY_WIRE: Record<FilterFieldType, FieldType> = {
    string: FIELD_TYPE.String,
    number: FIELD_TYPE.Number,
    boolean: FIELD_TYPE.Boolean,
    uuid: FIELD_TYPE.Uuid,
    date: FIELD_TYPE.Date,
    enum: FIELD_TYPE.Enum
};

/** A runtime `MessageDescriptor` for a dynamic (schema-derived) label. */
function descriptor(id: string, defaultMessage: string): MessageDescriptor {
    return { id, defaultMessage };
}

/**
 * Maps one server-derived filterable path to the query-builder's `FilterField`.
 * Labels are runtime descriptors (the field set is dynamic), namespaced by the
 * root type and the dotted path so they stay stable; the server's plain-string
 * labels become each descriptor's `defaultMessage`. Replaces the old
 * hand-mirrored `filterFieldsFromSchema` — the surface is now built once, on the
 * server, so the picker and the SQL whitelist can't drift.
 */
export function toFilterField(
    typeName: string,
    wire: WireFilterField
): FilterField {
    const base = `content.filter.${typeName}.${wire.path}`;
    const field: FilterField = {
        id: wire.path,
        label: descriptor(base, wire.label),
        type: FIELD_TYPE_BY_WIRE[wire.type]
    };
    if (wire.group.length > 0) {
        field.group = wire.group.map((crumb, i) =>
            descriptor(`${base}.group.${i}`, crumb)
        );
    }
    if (wire.enumValues) {
        field.enumValues = wire.enumValues.map((value) => ({
            value,
            label: descriptor(`${base}.${value}`, value)
        }));
    }
    if (wire.relationTarget) field.relationTarget = wire.relationTarget;
    return field;
}
