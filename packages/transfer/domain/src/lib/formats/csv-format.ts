/**
 * The CSV format — one flat table per type.
 *
 * Everything it cannot carry is listed in `flatten.ts`; this file is only the
 * table layer on top of that. Worth restating one decision here, because it is
 * the one that surprises people: a CSV export of several types produces
 * **several files**, and the server zips them. A single table with a `$type`
 * column would need the union of every type's fields as its header, which is
 * unreadable in the tool people open CSV in.
 */

import {
    TRANSFER_FORMAT_VERSION,
    type TransferDocument,
    type TransferManifest,
    type TransferRecord
} from '../document/transfer-document';
import { encodeCsv, parseCsv } from '../csv/csv';
import { csvColumns, recordToRow, rowToRecord } from '../csv/flatten';
import { TRANSFER_FORMAT } from './format';
import {
    TransferParseError,
    type ExportSerializer,
    type ImportParser,
    type ParseContext,
    type TransferFile
} from './ports';

/** Groups records by type, preserving first-seen order. */
function byType(
    records: readonly TransferRecord[]
): Map<string, TransferRecord[]> {
    const groups = new Map<string, TransferRecord[]>();
    for (const record of records) {
        const bucket = groups.get(record.$type);
        if (bucket) bucket.push(record);
        else groups.set(record.$type, [record]);
    }
    return groups;
}

/** Writes one `<type>.csv` per type in the document. */
export const csvSerializer: ExportSerializer = {
    format: TRANSFER_FORMAT.Csv,
    serialize(document, context): TransferFile[] {
        const files: TransferFile[] = [];
        for (const [type, records] of byType(document.records)) {
            const schema = context.schemas[type];
            // A type with no schema cannot be laid out as columns. Skipping it
            // silently would hand back a file that looks complete, so this is a
            // hard failure at export time instead.
            if (!schema) {
                throw new TransferParseError(
                    `No schema for content type "${type}" — cannot lay out its columns.`
                );
            }
            const columns = csvColumns(schema);
            const rows = [
                columns,
                ...records.map((record) =>
                    recordToRow(record, schema, context.identityFieldsOf)
                )
            ];
            files.push({ path: `${type}.csv`, text: encodeCsv(rows) });
        }
        return files;
    }
};

/**
 * Reads `<type>.csv` files back.
 *
 * The type comes from the filename, falling back to
 * {@link ParseContext.defaultType} — the collection whose Import button was
 * pressed. A file named after nothing this installation has is refused by name
 * rather than being guessed into the wrong table.
 */
export const csvParser: ImportParser = {
    format: TRANSFER_FORMAT.Csv,
    parse(files, context): TransferDocument {
        const records: TransferRecord[] = [];

        for (const file of files) {
            const type = typeOfFile(file.path, context);
            const schema = context.schemas[type];
            if (!schema) {
                throw new TransferParseError(
                    `"${file.path}" names content type "${type}", which this installation doesn't have.`
                );
            }
            const rows = parseCsv(file.text, {
                maxRows: context.limits.maxRecords + 1,
                maxColumns: context.limits.maxColumns
            });
            if (rows.length === 0) continue;

            const columns = rows[0].map((header) => header.trim());
            assertKnownColumns(
                columns,
                schema.fields.map((f) => f.name),
                file.path
            );

            for (const row of rows.slice(1)) {
                // A row of nothing but empty cells is what a trailing blank
                // line in a spreadsheet looks like; importing it would create a
                // blank record on every round trip.
                if (row.every((cell) => cell.trim() === '')) continue;
                records.push(
                    rowToRecord(row, columns, schema, context.identityFieldsOf)
                );
            }
        }

        return { manifest: syntheticManifest(context, records), records };
    }
};

/** Derives a type name from a CSV filename. */
function typeOfFile(path: string, context: ParseContext): string {
    const base = path.split('/').pop() ?? path;
    const stem = base.replace(/\.csv$/i, '');
    if (stem && context.schemas[stem]) return stem;
    if (context.defaultType) return context.defaultType;
    return stem;
}

/**
 * Refuses a header naming a field the type doesn't have.
 *
 * Ignoring the column instead would be worse than it sounds: a typo'd or
 * renamed header means an entire column of edited copy is dropped, and the
 * import reports success. Better to name the column and stop.
 */
function assertKnownColumns(
    columns: readonly string[],
    fieldNames: readonly string[],
    path: string
): void {
    const known = new Set<string>([
        ...fieldNames,
        '$id',
        '$depth',
        '$locale',
        '$localeGroup',
        '$status'
    ]);
    const unknown = columns.filter(
        (column) => column !== '' && !known.has(column)
    );
    if (unknown.length > 0) {
        throw new TransferParseError(
            `"${path}" has column(s) this type doesn't have: ${unknown.join(', ')}.`
        );
    }
}

/**
 * A CSV carries no manifest, so one is synthesised.
 *
 * `depth` is all-false and that is accurate rather than a placeholder: a flat
 * table reached nothing beyond the rows in it.
 */
function syntheticManifest(
    context: ParseContext,
    records: readonly TransferRecord[]
): TransferManifest {
    const rootType = context.defaultType ?? records[0]?.$type ?? '';
    const identity: Record<string, string[]> = {};
    for (const record of records) {
        identity[record.$type] = [...context.identityFieldsOf(record.$type)];
    }
    return {
        version: TRANSFER_FORMAT_VERSION,
        exportedAt: new Date(0).toISOString(),
        sourceWorkspaceId: '',
        rootType,
        depth: {
            relations: false,
            media: false,
            locales: false,
            relationLocales: false
        },
        identity,
        counts: {
            roots: records.length,
            related: 0,
            assets: 0,
            assetBytes: 0
        }
    };
}
