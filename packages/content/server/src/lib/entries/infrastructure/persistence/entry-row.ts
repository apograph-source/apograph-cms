/**
 * Pure row ↔ entry mappers shared by the read ({@link EntriesService}) and write
 * ({@link EntryWriterService}) paths, so the wire shape and the column projection
 * have one definition each. No DB access, no NestJS — just shape translation.
 */

import { isEmptyRichText } from '@orthacms/content-domain';
import type { AnyContentType } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE, isEmptyFieldValue } from '../../../types/fields';
import type { EntryRecord } from '../../types/entry-list-view';

/** A generated content table row seen as a bag of values by property name. */
type Row = Record<string, unknown>;

/**
 * Map a raw DB row to the admin {@link EntryRecord}: envelope fields plus a
 * `values` bag keyed by field name. `status`/`publishedAt` are emitted only for
 * publishable types. Relations that own no column — many-relations (their links live in join
 * tables) and inverse/back-references (they reuse the owning side's storage) —
 * aren't selected here; an owning single relation passes through as its FK uuid.
 */
export function toRecord(type: AnyContentType, row: Row): EntryRecord {
    const values: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(type.fields)) {
        if (
            spec.type === CONTENT_FIELD_TYPE.Relation &&
            (spec.relation?.many || spec.relation?.inverse)
        )
            continue;
        values[name] = row[name] ?? null;
    }
    const record: EntryRecord = {
        id: row['id'] as string,
        createdAt: (row['createdAt'] as Date).toISOString(),
        updatedAt: (row['updatedAt'] as Date).toISOString(),
        values
    };
    if (type.publishable) {
        record.status = row['status'] as EntryRecord['status'];
        // Carried alongside `status` because the two together name the publish
        // state: a `draft` that has a `published_at` still has live content
        // behind it (the admin's "Modified"), unlike one that never published.
        const publishedAt = row['publishedAt'] as Date | null | undefined;
        record.publishedAt = publishedAt ? publishedAt.toISOString() : null;
    }
    if (type.i18n) {
        record.locale = row['locale'] as string;
        record.localeGroupId = row['localeGroupId'] as string;
    }
    return record;
}

/**
 * The shared empty-value test (see {@link isEmptyFieldValue}), taught the one
 * thing it cannot see on its own: a **rich-text document** is a JSON object, so
 * the empty one an editor leaves behind (`{ doc: [paragraph] }`) is neither
 * null, nor blank, nor an empty array. Storing that instead of `null` would
 * make a cleared body read as content — `required` would pass, the publish gate
 * would let it through, and the admin's "Changed" badge would disagree with
 * what the author sees.
 */
function isEmpty(value: unknown, spec?: { type: string }): boolean {
    return spec?.type === CONTENT_FIELD_TYPE.RichText
        ? isEmptyRichText(value)
        : isEmptyFieldValue(value);
}

/**
 * Normalize the admin's (string-shaped) `values` bag to the proper JS types the
 * validator and storage expect — numbers parsed, JSON text parsed, empties
 * collapsed to null — keeping every field (so a many-relation array still
 * validates). The single coercion point: both {@link toColumns} (storage) and
 * the writer's validation run against the result, so they can't disagree on a
 * value's type. Datetime/date stay ISO strings (the validator accepts them;
 * {@link toColumns} converts datetime to `Date` for `timestamptz`).
 */
export function coerceValues(
    type: AnyContentType,
    values: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(type.fields)) {
        let value = values[name];
        if (isEmpty(value, spec)) {
            out[name] = Array.isArray(value) ? value : null;
            continue;
        }
        switch (spec.type) {
            case CONTENT_FIELD_TYPE.Number:
            case CONTENT_FIELD_TYPE.Money:
                // NaN when unparseable — the validator reports "must be a number".
                value = typeof value === 'number' ? value : Number(value);
                break;
            case CONTENT_FIELD_TYPE.Json:
                if (typeof value === 'string') {
                    try {
                        value = JSON.parse(value);
                    } catch {
                        // Unparseable: collapse to null rather than persist the
                        // raw string into the jsonb column (which would store a
                        // string scalar where consumers expect structured data).
                        // Mirrors the invalid-date / NaN-number handling below.
                        // A required Json field then fails validation as empty.
                        value = null;
                    }
                }
                break;
        }
        out[name] = value;
    }
    return out;
}

/**
 * Project a (coerced) `values` bag onto the columns of a generated table for an
 * insert/update. Includes only keys declared on the type (reserved envelope
 * columns — `status`/`published_at`/`deleted_at`/timestamps — are owned by the
 * service, never the client), skips relations that own no column (many-relations,
 * whose links live in join tables, and inverse/back-references, which reuse the
 * owning side's storage), collapses empties to `null`, converts a `datetime` to a `Date` for
 * the `timestamptz` column (guarding an invalid date to `null` rather than
 * letting `pg` throw), and drops a `NaN` number to `null`. A field absent from
 * `values` is written as `null` — the editor submits the full bag, so a write
 * replaces the whole document.
 */
export function toColumns(
    type: AnyContentType,
    values: Record<string, unknown>
): Record<string, unknown> {
    const columns: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(type.fields)) {
        if (
            spec.type === CONTENT_FIELD_TYPE.Relation &&
            (spec.relation?.many || spec.relation?.inverse)
        )
            continue;
        let value = values[name];
        if (isEmpty(value, spec)) {
            columns[name] = null;
            continue;
        }
        if (spec.type === CONTENT_FIELD_TYPE.Datetime) {
            const date =
                value instanceof Date ? value : new Date(String(value));
            value = Number.isNaN(date.getTime()) ? null : date;
        } else if (
            spec.type === CONTENT_FIELD_TYPE.Number ||
            spec.type === CONTENT_FIELD_TYPE.Money
        ) {
            const num = typeof value === 'number' ? value : Number(value);
            value = Number.isNaN(num) ? null : num;
        }
        columns[name] = value;
    }
    return columns;
}

/**
 * Field types short enough to label a row by. Text first, then Select — both are
 * compact strings, unlike richtext (potentially huge HTML).
 */
const TITLE_FIELD_TYPES: ReadonlySet<string> = new Set([
    CONTENT_FIELD_TYPE.Text,
    CONTENT_FIELD_TYPE.Select
]);

/**
 * A human display label for an entry — the first non-empty title-eligible field's
 * value (see {@link TITLE_FIELD_TYPES}), falling back to the id. Used to label
 * rows in the bulk-publish preview.
 */
export function entryTitle(type: AnyContentType, row: Row): string {
    for (const [name, spec] of Object.entries(type.fields)) {
        if (!TITLE_FIELD_TYPES.has(spec.type)) continue;
        const value = row[name];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return row['id'] as string;
}

/**
 * The slug handle for an entry — the value of its **slug field**: the first
 * field flagged `admin.widget === 'slug'`, else a field literally named `slug`.
 * Returns the trimmed value when present and non-empty, otherwise `undefined`
 * (the type has no slug field, or the row's slug is blank). Used to give a
 * linked relation record a stable `/handle` in the admin.
 */
export function entrySlug(type: AnyContentType, row: Row): string | undefined {
    let named: string | undefined;
    for (const [name, spec] of Object.entries(type.fields)) {
        const value = row[name];
        if (typeof value !== 'string' || !value.trim()) continue;
        if (spec.admin?.widget === 'slug') return value;
        if (name === 'slug') named = value;
    }
    return named;
}
