/**
 * The format seam: one port for writing a document, one for reading it back.
 *
 * Adding XLSX or XML later is a new pair of implementations and a row in the
 * capability table — not a branch inside the graph walker, which is why the
 * walker never learns what a format is.
 */

import type { TransferDocument } from '../document/transfer-document';
import type { TransferSchemas } from '../schema/type-schema';
import type { TransferFormat } from './format';

/**
 * One text member of an export.
 *
 * A serializer returns a list because a format may legitimately be several
 * files (a CSV per type, an archive's manifest plus its record files). The
 * server decides what to do with the list: one member streams as-is, several
 * become an archive.
 */
export interface TransferFile {
    /** Path inside the archive, or the download's filename for a lone member. */
    path: string;
    /** UTF-8 text. */
    text: string;
}

/** What a serializer needs beyond the document itself. */
export interface SerializeContext {
    /** Schemas of every type in the document, keyed by name. */
    schemas: TransferSchemas;
    /** A type's identity fields, as resolved at export time. */
    identityFieldsOf(type: string): readonly string[];
}

/** Writes a document down in one format. */
export interface ExportSerializer {
    readonly format: TransferFormat;
    serialize(
        document: TransferDocument,
        context: SerializeContext
    ): TransferFile[];
}

/** What a parser needs beyond the bytes. */
export interface ParseContext extends SerializeContext {
    /**
     * The type a format that cannot name one is assumed to hold. CSV columns
     * describe fields but never the type, so the caller supplies it from the
     * route the file was uploaded to.
     */
    defaultType?: string;
    /** Bounds a hostile file is held to. */
    limits: ParseLimits;
}

/** Bounds on parsing an untrusted file. */
export interface ParseLimits {
    /** Maximum records in one document. */
    maxRecords: number;
    /** Maximum columns in a flat row. */
    maxColumns: number;
}

/** Raised when a file cannot be read as a transfer document. */
export class TransferParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TransferParseError';
    }
}

/** Reads a document back from one format. */
export interface ImportParser {
    readonly format: TransferFormat;
    parse(
        files: readonly TransferFile[],
        context: ParseContext
    ): TransferDocument;
}
