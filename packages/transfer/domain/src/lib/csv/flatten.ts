/**
 * Flattening a record into a spreadsheet row, and reading one back.
 *
 * This is the **lossy** edge of transfer, and the loss is structural rather
 * than accidental: a table has one value per cell, and a record has a rich-text
 * document, an ordered list of links, and a set of files. Nothing here can fix
 * that. What it can do is make the loss predictable, reversible where the shape
 * allows, and impossible to mistake for a full export — which is why the CSV
 * format advertises `lossless: false` and the dialog says so before the click.
 *
 * The use case this serves well is the real one: pull a column of copy out,
 * translate or proof it in a spreadsheet, put it back.
 */

import {
    CONTENT_FIELD_TYPE,
    htmlToRichTextDocument,
    isRichTextDocument,
    richTextPlainText
} from '@ortha/content-domain';
import type {
    TransferAssetRef,
    TransferRecord,
    TransferRef
} from '../document/transfer-document';
import {
    owningRelationFields,
    type TransferTypeSchema
} from '../schema/type-schema';

/** Envelope columns, in the order they lead every row. */
export const ENVELOPE_COLUMNS = [
    '$id',
    '$depth',
    '$locale',
    '$localeGroup',
    '$status'
] as const;

/** Separates the refs of a many-relation within one cell. */
const REF_SEPARATOR = ';';
/** Separates the key parts of one ref. */
const KEY_SEPARATOR = '|';

/** Escapes the separators (and the escape character) inside a key value. */
function escapeToken(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(new RegExp(`\\${REF_SEPARATOR}`, 'g'), `\\${REF_SEPARATOR}`)
        .replace(new RegExp(`\\${KEY_SEPARATOR}`, 'g'), `\\${KEY_SEPARATOR}`);
}

/** Reverses {@link escapeToken}. */
function unescapeToken(value: string): string {
    return value.replace(/\\(.)/g, '$1');
}

/** Splits on `separator`, honouring backslash escapes. */
function splitEscaped(value: string, separator: string): string[] {
    const parts: string[] = [];
    let current = '';
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (char === '\\' && i + 1 < value.length) {
            current += char + value[i + 1];
            i += 1;
        } else if (char === separator) {
            parts.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    parts.push(current);
    return parts;
}

/** Renders one reference as `type:key1|key2`. */
export function formatRefToken(
    ref: TransferRef,
    identityFields: readonly string[]
): string {
    const parts = identityFields.map((field) =>
        escapeToken(ref.$key[field] ?? '')
    );
    // With no identity fields there is nothing human-readable to write, so fall
    // back to the source id — useless across installations, but honest, and it
    // still round-trips within one document.
    const body = parts.length > 0 ? parts.join(KEY_SEPARATOR) : (ref.$id ?? '');
    return `${escapeToken(ref.$type)}:${body}`;
}

/** Reads a `type:key1|key2` token back into a reference. */
export function parseRefToken(
    token: string,
    identityFieldsOf: (type: string) => readonly string[]
): TransferRef | undefined {
    const trimmed = token.trim();
    if (!trimmed) return undefined;
    // Split on the FIRST unescaped colon: a key value may legitimately contain
    // one (a URL, a timestamp), the type name may not.
    const colon = indexOfUnescaped(trimmed, ':');
    if (colon < 0) return undefined;
    const type = unescapeToken(trimmed.slice(0, colon));
    const body = trimmed.slice(colon + 1);
    const fields = identityFieldsOf(type);
    if (fields.length === 0) {
        return { $type: type, $id: unescapeToken(body), $key: {} };
    }
    const values = splitEscaped(body, KEY_SEPARATOR).map(unescapeToken);
    const key: Record<string, string> = {};
    fields.forEach((field, index) => {
        const value = values[index];
        if (value) key[field] = value;
    });
    return { $type: type, $key: key };
}

/** Index of the first `char` not preceded by a backslash, or -1. */
function indexOfUnescaped(value: string, char: string): number {
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === '\\') {
            i += 1;
            continue;
        }
        if (value[i] === char) return i;
    }
    return -1;
}

/** The column headers for one type, envelope first then fields in schema order. */
export function csvColumns(schema: TransferTypeSchema): string[] {
    const columns: string[] = [...ENVELOPE_COLUMNS];
    for (const field of schema.fields) {
        // The inverse side of a two-way relation owns no storage; writing it
        // would offer the reader a column whose edits go nowhere.
        if (field.relation?.inverse) continue;
        columns.push(field.name);
    }
    return columns;
}

/** Renders one scalar value for a cell. */
function formatValue(value: unknown, fieldType: string): string {
    if (value === null || value === undefined) return '';
    if (fieldType === CONTENT_FIELD_TYPE.RichText) {
        // The body's text, not its markup — the thing a translator works on.
        return isRichTextDocument(value)
            ? richTextPlainText(value)
            : String(value);
    }
    if (fieldType === CONTENT_FIELD_TYPE.Multiselect) {
        return Array.isArray(value)
            ? value.map((item) => escapeToken(String(item))).join(REF_SEPARATOR)
            : '';
    }
    if (fieldType === CONTENT_FIELD_TYPE.Json) return JSON.stringify(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/** Renders a record's media field as a `;`-separated list of file names. */
function formatMedia(assets: readonly TransferAssetRef[]): string {
    return assets
        .map((asset) => escapeToken(asset.url ?? asset.path ?? asset.name))
        .join(REF_SEPARATOR);
}

/** Turns one record into a row aligned to {@link csvColumns}. */
export function recordToRow(
    record: TransferRecord,
    schema: TransferTypeSchema,
    identityFieldsOf: (type: string) => readonly string[]
): string[] {
    const row: string[] = [
        record.$id,
        String(record.$depth),
        record.$locale ?? '',
        record.$localeGroup ?? '',
        record.$status ?? ''
    ];

    for (const field of schema.fields) {
        if (field.relation?.inverse) continue;

        if (field.relation) {
            const value = record.relations[field.name];
            const refs =
                value == null ? [] : Array.isArray(value) ? value : [value];
            row.push(
                refs
                    .map((ref) =>
                        formatRefToken(ref, identityFieldsOf(ref.$type))
                    )
                    .join(REF_SEPARATOR)
            );
            continue;
        }

        if (field.type === CONTENT_FIELD_TYPE.Media) {
            row.push(
                formatMedia(
                    record.media.filter((asset) => asset.field === field.name)
                )
            );
            continue;
        }

        row.push(formatValue(record.values[field.name], field.type));
    }
    return row;
}

/** Parses a cell back into a field value. */
function parseValue(cell: string, fieldType: string): unknown {
    if (cell === '') return null;
    switch (fieldType) {
        case CONTENT_FIELD_TYPE.Number:
        case CONTENT_FIELD_TYPE.Money: {
            const parsed = Number(cell);
            return Number.isFinite(parsed) ? parsed : null;
        }
        case CONTENT_FIELD_TYPE.Boolean:
            return cell === 'true' || cell === '1';
        case CONTENT_FIELD_TYPE.Multiselect:
            return splitEscaped(cell, REF_SEPARATOR)
                .map(unescapeToken)
                .filter((item) => item !== '');
        case CONTENT_FIELD_TYPE.Json:
            try {
                return JSON.parse(cell);
            } catch {
                // A cell that isn't JSON is kept as the string it is; the
                // field validator reports it, which beats failing the whole
                // file on one malformed cell.
                return cell;
            }
        case CONTENT_FIELD_TYPE.RichText:
            // Plain text back into a document: each line becomes a paragraph,
            // which is the inverse of what `richTextPlainText` produced.
            return htmlToRichTextDocument(
                cell
                    .split(/\r?\n/)
                    .map((line) => `<p>${escapeHtml(line)}</p>`)
                    .join('')
            );
        default:
            return cell;
    }
}

/** Escapes text for embedding in the HTML handed to the rich-text converter. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Reads one row back into a record.
 *
 * Media cells are **not** reconstructed: a file name in a spreadsheet is not a
 * file, and inventing an asset reference from one would silently relink records
 * to whatever happened to share the name. The cell is ignored, and the record's
 * existing media is left alone by the importer.
 */
export function rowToRecord(
    row: readonly string[],
    columns: readonly string[],
    schema: TransferTypeSchema,
    identityFieldsOf: (type: string) => readonly string[]
): TransferRecord {
    const cell = (name: string): string => {
        const index = columns.indexOf(name);
        return index >= 0 ? (row[index] ?? '') : '';
    };

    const values: Record<string, unknown> = {};
    const relations: Record<string, TransferRef | TransferRef[] | null> = {};

    for (const field of owningRelationFields(schema)) {
        const raw = cell(field.name);
        if (columns.indexOf(field.name) < 0) continue;
        const refs = splitEscaped(raw, REF_SEPARATOR)
            .map((token) => parseRefToken(token, identityFieldsOf))
            .filter((ref): ref is TransferRef => ref !== undefined);
        relations[field.name] = field.relation?.many ? refs : (refs[0] ?? null);
    }

    for (const field of schema.fields) {
        if (field.relation) continue;
        if (field.type === CONTENT_FIELD_TYPE.Media) continue;
        if (columns.indexOf(field.name) < 0) continue;
        values[field.name] = parseValue(cell(field.name), field.type);
    }

    const depth = Number(cell('$depth'));
    return {
        $type: schema.name,
        $id: cell('$id'),
        $key: {},
        $depth: depth === 1 ? 1 : 0,
        ...(cell('$locale') ? { $locale: cell('$locale') } : {}),
        ...(cell('$localeGroup') ? { $localeGroup: cell('$localeGroup') } : {}),
        ...(cell('$status')
            ? { $status: cell('$status') as TransferRecord['$status'] }
            : {}),
        values,
        relations,
        media: []
    };
}
