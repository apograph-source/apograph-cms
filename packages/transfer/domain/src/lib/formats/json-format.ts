/**
 * The JSON and NDJSON formats — the lossless pair.
 *
 * JSON is one object and is the readable choice; NDJSON is the same records one
 * per line, which is what lets a large export stream instead of being assembled
 * in memory first. They share a record encoding on purpose: a document written
 * as one can be read as the other with no information lost either way.
 */

import {
    TRANSFER_FORMAT_VERSION,
    type TransferDocument,
    type TransferManifest,
    type TransferRecord
} from '../document/transfer-document';
import { TRANSFER_FORMAT } from './format';
import {
    TransferParseError,
    type ExportSerializer,
    type ImportParser,
    type ParseContext,
    type TransferFile
} from './ports';

/** Filename an NDJSON manifest line is tagged with. */
const MANIFEST_KEY = '$manifest';

/** Writes the whole document as one indented JSON object. */
export const jsonSerializer: ExportSerializer = {
    format: TRANSFER_FORMAT.Json,
    serialize(document: TransferDocument): TransferFile[] {
        return [
            {
                path: 'export.json',
                text: JSON.stringify(document, null, 2)
            }
        ];
    }
};

/** Writes the manifest on line 1 and one record per line after it. */
export const ndjsonSerializer: ExportSerializer = {
    format: TRANSFER_FORMAT.Ndjson,
    serialize(document: TransferDocument): TransferFile[] {
        const lines = [
            JSON.stringify({ [MANIFEST_KEY]: document.manifest }),
            ...document.records.map((record) => JSON.stringify(record))
        ];
        return [{ path: 'export.ndjson', text: `${lines.join('\n')}\n` }];
    }
};

/** Reads a document written by {@link jsonSerializer}. */
export const jsonParser: ImportParser = {
    format: TRANSFER_FORMAT.Json,
    parse(files, context): TransferDocument {
        const text = requireSingle(files).text;
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new TransferParseError('The file is not valid JSON.');
        }
        if (!isObject(parsed)) {
            throw new TransferParseError(
                'The file does not contain a transfer document.'
            );
        }
        const manifest = assertManifest(parsed['manifest']);
        const rawRecords = parsed['records'];
        if (!Array.isArray(rawRecords)) {
            throw new TransferParseError('The document has no records list.');
        }
        assertRecordCount(rawRecords.length, context);
        return {
            manifest,
            records: rawRecords.map((record, index) =>
                assertRecord(record, index)
            )
        };
    }
};

/** Reads a document written by {@link ndjsonSerializer}. */
export const ndjsonParser: ImportParser = {
    format: TRANSFER_FORMAT.Ndjson,
    parse(files, context): TransferDocument {
        const lines = requireSingle(files)
            .text.split('\n')
            .filter((line) => line.trim() !== '');
        if (lines.length === 0) {
            throw new TransferParseError('The file is empty.');
        }
        return parseNdjsonLines(lines, context);
    }
};

/**
 * Shared by the NDJSON format and the archive's per-type record files, which
 * are the same encoding minus the manifest line.
 */
export function parseNdjsonLines(
    lines: readonly string[],
    context: ParseContext,
    knownManifest?: TransferManifest
): TransferDocument {
    let manifest = knownManifest;
    const records: TransferRecord[] = [];

    lines.forEach((line, index) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            throw new TransferParseError(
                `Line ${index + 1} is not valid JSON.`
            );
        }
        if (isObject(parsed) && MANIFEST_KEY in parsed) {
            manifest = assertManifest(parsed[MANIFEST_KEY]);
            return;
        }
        records.push(assertRecord(parsed, index));
    });

    if (!manifest) {
        throw new TransferParseError('The document has no manifest.');
    }
    assertRecordCount(records.length, context);
    return { manifest, records };
}

/** Rejects a document count over the limit before anything is built from it. */
function assertRecordCount(count: number, context: ParseContext): void {
    if (count > context.limits.maxRecords) {
        throw new TransferParseError(
            `The document holds ${count} records, over the ${context.limits.maxRecords} limit.`
        );
    }
}

function requireSingle(files: readonly TransferFile[]): TransferFile {
    if (files.length !== 1) {
        throw new TransferParseError('Expected exactly one file.');
    }
    return files[0];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the manifest hard enough that everything downstream can trust it.
 *
 * The version check is the important one: a document from a future exporter may
 * mean something different by the same field names, and reading it anyway is
 * how a "successful" import quietly writes wrong data.
 */
function assertManifest(value: unknown): TransferManifest {
    if (!isObject(value)) {
        throw new TransferParseError('The document has no manifest.');
    }
    const version = value['version'];
    if (typeof version !== 'number') {
        throw new TransferParseError('The manifest has no format version.');
    }
    if (version > TRANSFER_FORMAT_VERSION) {
        throw new TransferParseError(
            `This file was written by a newer version of Ortha (format ${version}; this installation reads ${TRANSFER_FORMAT_VERSION}). Upgrade before importing it.`
        );
    }
    if (typeof value['rootType'] !== 'string') {
        throw new TransferParseError('The manifest names no content type.');
    }
    return value as unknown as TransferManifest;
}

/** Checks one record's envelope. Field values stay unvalidated here — that is the writer's job. */
function assertRecord(value: unknown, index: number): TransferRecord {
    if (!isObject(value)) {
        throw new TransferParseError(`Record ${index + 1} is not an object.`);
    }
    if (typeof value['$type'] !== 'string') {
        throw new TransferParseError(`Record ${index + 1} names no type.`);
    }
    const record = value as unknown as TransferRecord;
    return {
        ...record,
        $id: typeof record.$id === 'string' ? record.$id : '',
        $key: isObject(record.$key)
            ? (record.$key as Record<string, string>)
            : {},
        $depth: record.$depth === 1 ? 1 : 0,
        values: isObject(record.values) ? record.values : {},
        relations: isObject(record.relations) ? record.relations : {},
        media: Array.isArray(record.media) ? record.media : []
    };
}
