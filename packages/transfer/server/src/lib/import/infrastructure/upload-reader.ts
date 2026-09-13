/**
 * Turning an uploaded file into a document.
 *
 * This is the boundary: above it everything is a `TransferDocument` this
 * codebase understands, below it are bytes a stranger chose. Two rules hold the
 * line, and both are about not trusting a claim:
 *
 * - **The bytes decide the format, not the filename.** A `.json` that starts
 *   with a ZIP signature is an archive; a client naming a format is a hint.
 * - **Nothing in the file names a workspace.** The manifest carries the source
 *   workspace and the importer never reads it — the request's workspace is
 *   stamped on every write. A hand-edited manifest is therefore not a way
 *   across the tenancy boundary, only a way to mislabel your own export.
 */

import { BadRequestException } from '@nestjs/common';
import {
    TRANSFER_FORMAT,
    TransferParseError,
    formatFromFilename,
    parserFor,
    type ParseContext,
    type TransferDocument,
    type TransferFile,
    type TransferFormat,
    type TransferLimits
} from '@apograph/transfer-domain';
import {
    ZipReadError,
    looksLikeZip,
    readZipDirectory,
    readZipEntry
} from '../../archive/zip-reader';

/** An uploaded file, as multer hands it over. */
export interface UploadedTransferFile {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
}

/** The document plus the asset bytes that travelled with it. */
export interface ReadUpload {
    document: TransferDocument;
    /** Archive members under `assets/`, keyed by their archive path. */
    assets: Map<string, Buffer>;
    /** The format actually detected, which may differ from what was claimed. */
    format: TransferFormat;
}

/**
 * Reads an upload into a document.
 *
 * Every failure below becomes a `400` with a sentence a person can act on. That
 * is not politeness: an import failing with a stack trace is the case where
 * someone retries the same broken file five times.
 */
export function readUpload(
    file: UploadedTransferFile,
    context: Omit<ParseContext, 'limits'> & { limits: TransferLimits }
): ReadUpload {
    const limits = context.limits;
    if (file.size > limits.maxUploadBytes) {
        throw new BadRequestException(
            `That file is ${file.size} bytes, over the ${limits.maxUploadBytes}-byte upload limit.`
        );
    }
    if (file.size === 0) {
        throw new BadRequestException('That file is empty.');
    }

    const parseContext: ParseContext = {
        ...context,
        limits: {
            maxRecords: limits.maxImportRecords,
            maxColumns: limits.maxColumns
        }
    };

    try {
        if (looksLikeZip(file.buffer)) {
            return readArchive(file.buffer, parseContext, limits);
        }
        const format =
            formatFromFilename(file.originalname) ??
            sniffTextFormat(file.buffer);
        const text = decodeText(file.buffer);
        const files: TransferFile[] = [{ path: file.originalname, text }];
        return {
            document: parserFor(format).parse(files, parseContext),
            assets: new Map(),
            format
        };
    } catch (error) {
        if (
            error instanceof TransferParseError ||
            error instanceof ZipReadError
        ) {
            throw new BadRequestException(error.message);
        }
        throw error;
    }
}

/** Reads an archive: its text members become the document, `assets/` the bytes. */
function readArchive(
    buffer: Buffer,
    context: ParseContext,
    limits: TransferLimits
): ReadUpload {
    // Directory first — every size and path is checked before anything is
    // inflated. See `zip-reader.ts` for why that order is the whole defence.
    const entries = readZipDirectory(buffer, limits);
    const textFiles: TransferFile[] = [];
    const assets = new Map<string, Buffer>();

    for (const entry of entries) {
        const bytes = readZipEntry(buffer, entry, limits);
        if (entry.path.startsWith('assets/')) {
            assets.set(entry.path, bytes);
            continue;
        }
        // Only the members the archive format defines are read as text; an
        // archive someone dropped a README into still imports.
        if (
            entry.path === 'manifest.json' ||
            entry.path.endsWith('.ndjson') ||
            entry.path.endsWith('.csv') ||
            entry.path.endsWith('.json')
        ) {
            textFiles.push({ path: entry.path, text: decodeText(bytes) });
        }
    }

    // A ZIP of CSVs is what a multi-type CSV export produces, so it has to come
    // back the same way.
    const format = textFiles.some((file) => file.path.endsWith('.csv'))
        ? TRANSFER_FORMAT.Csv
        : TRANSFER_FORMAT.Zip;

    return {
        document: parserFor(format).parse(textFiles, context),
        assets,
        format
    };
}

/**
 * Decodes bytes as UTF-8, refusing anything that isn't.
 *
 * `Buffer.toString('utf8')` never throws — it substitutes U+FFFD — so invalid
 * bytes would otherwise arrive as replacement characters silently written into
 * content. Better to say the file isn't UTF-8 than to import mojibake.
 */
function decodeText(buffer: Buffer): string {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    if (text.includes('�')) {
        throw new TransferParseError(
            'That file is not valid UTF-8 text. Re-save it as UTF-8 and try again.'
        );
    }
    return text;
}

/** Last-resort format guess from the first non-whitespace character. */
function sniffTextFormat(buffer: Buffer): TransferFormat {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart();
    if (head.startsWith('{')) {
        // A JSON document starts with the manifest key; NDJSON's first line is
        // a complete object followed by a newline and another one.
        const firstBreak = head.indexOf('\n');
        if (
            firstBreak > 0 &&
            head.slice(0, firstBreak).trimEnd().endsWith('}')
        ) {
            return TRANSFER_FORMAT.Ndjson;
        }
        return TRANSFER_FORMAT.Json;
    }
    return TRANSFER_FORMAT.Csv;
}
