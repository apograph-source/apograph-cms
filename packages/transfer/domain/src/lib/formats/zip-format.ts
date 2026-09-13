/**
 * The archive format's **text** side.
 *
 * The archive is the only format that carries asset bytes, and bytes are not
 * this package's business — `transfer-server` owns the container and the
 * storage reads. What lives here is the part that is pure: which text members
 * an archive holds and how they are laid out, so the reader and the writer
 * agree on it in one place.
 *
 * Layout:
 * ```
 * manifest.json          the document header
 * entries/<type>.ndjson  one record per line, per type
 * assets/<id>/<name>     added by the server, not by this serializer
 * ```
 */

import type {
    TransferDocument,
    TransferRecord
} from '../document/transfer-document';
import { TRANSFER_FORMAT } from './format';
import { parseNdjsonLines } from './json-format';
import {
    TransferParseError,
    type ExportSerializer,
    type ImportParser,
    type TransferFile
} from './ports';

/** Archive member holding the document header. */
export const MANIFEST_PATH = 'manifest.json';
/** Directory holding the per-type record files. */
export const ENTRIES_DIR = 'entries/';
/** Directory holding asset bytes. */
export const ASSETS_DIR = 'assets/';

/** Writes `manifest.json` plus one `entries/<type>.ndjson` per type. */
export const zipSerializer: ExportSerializer = {
    format: TRANSFER_FORMAT.Zip,
    serialize(document: TransferDocument): TransferFile[] {
        const files: TransferFile[] = [
            {
                path: MANIFEST_PATH,
                text: JSON.stringify(document.manifest, null, 2)
            }
        ];

        const groups = new Map<string, TransferRecord[]>();
        for (const record of document.records) {
            const bucket = groups.get(record.$type);
            if (bucket) bucket.push(record);
            else groups.set(record.$type, [record]);
        }
        for (const [type, records] of groups) {
            files.push({
                path: `${ENTRIES_DIR}${type}.ndjson`,
                text: `${records
                    .map((record) => JSON.stringify(record))
                    .join('\n')}\n`
            });
        }
        return files;
    }
};

/** Reads the text members of an archive back into a document. */
export const zipParser: ImportParser = {
    format: TRANSFER_FORMAT.Zip,
    parse(files, context): TransferDocument {
        const manifestFile = files.find((file) => file.path === MANIFEST_PATH);
        if (!manifestFile) {
            throw new TransferParseError(
                `The archive has no ${MANIFEST_PATH}.`
            );
        }

        const entryFiles = files.filter(
            (file) =>
                file.path.startsWith(ENTRIES_DIR) &&
                file.path.endsWith('.ndjson')
        );
        if (entryFiles.length === 0) {
            throw new TransferParseError(
                `The archive has no ${ENTRIES_DIR} record files.`
            );
        }

        // The manifest rides one synthetic line so the shared NDJSON reader
        // does the version check in exactly one place, rather than this file
        // growing a second copy of it that can drift.
        const manifestLine = JSON.stringify({
            $manifest: JSON.parse(manifestFile.text)
        });
        const first = parseNdjsonLines(
            [manifestLine, ...linesOf(entryFiles[0])],
            context
        );
        const records = [...first.records];
        for (const file of entryFiles.slice(1)) {
            records.push(
                ...parseNdjsonLines(linesOf(file), context, first.manifest)
                    .records
            );
        }
        if (records.length > context.limits.maxRecords) {
            throw new TransferParseError(
                `The archive holds ${records.length} records, over the ${context.limits.maxRecords} limit.`
            );
        }
        return { manifest: first.manifest, records };
    }
};

function linesOf(file: TransferFile): string[] {
    return file.text.split('\n').filter((line) => line.trim() !== '');
}
