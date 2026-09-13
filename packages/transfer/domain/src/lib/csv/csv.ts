/**
 * RFC 4180 CSV, encoded and decoded by hand.
 *
 * Hand-rolled rather than imported: this is ~100 lines against a stable
 * 20-year-old spec, and the alternative is a third-party parser in the one code
 * path that reads an untrusted file. Owning it means the failure modes are ours
 * — a row cap, an unterminated quote, a stray CR — rather than a dependency's.
 */

/** Fields containing these must be quoted. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * A UTF-8 byte-order mark.
 *
 * Excel writes one when it saves a CSV as UTF-8, and it lands on the first
 * header cell — so a file that round-trips through a spreadsheet gets a first
 * column nobody can match by name until it is stripped.
 */
const BOM = '﻿';

/** Encodes one field, quoting only when it has to. */
function encodeField(value: string): string {
    if (!MUST_QUOTE.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
}

/** Encodes rows to CSV text with CRLF line endings, as the RFC specifies. */
export function encodeCsv(rows: readonly (readonly string[])[]): string {
    return rows.map((row) => row.map(encodeField).join(',')).join('\r\n');
}

/** Raised when a CSV file cannot be read as one. */
export class CsvParseError extends Error {
    constructor(
        message: string,
        /** 1-based line the problem was noticed on. */
        readonly line: number
    ) {
        super(message);
        this.name = 'CsvParseError';
    }
}

/** Bounds on a parse, so a hostile file cannot exhaust memory. */
export interface CsvParseLimits {
    /** Maximum rows, header included. */
    maxRows: number;
    /** Maximum fields per row. */
    maxColumns: number;
}

/**
 * Parses CSV text into rows.
 *
 * A single pass over the characters, tracking whether the cursor is inside a
 * quoted field — the only way to get embedded commas, quotes and newlines right,
 * and the reason a `split(',')` implementation is always wrong on real
 * spreadsheet output.
 *
 * Accepts CRLF, LF and bare CR line endings, because all three arrive in
 * practice from Windows, Unix and older Mac exports respectively.
 */
export function parseCsv(text: string, limits: CsvParseLimits): string[][] {
    const source = text.startsWith(BOM) ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let line = 1;
    // Whether anything at all has been seen since the last row boundary, so a
    // trailing newline doesn't produce a phantom row of one empty field.
    let rowStarted = false;

    const endField = (): void => {
        row.push(field);
        field = '';
        rowStarted = true;
        if (row.length > limits.maxColumns) {
            throw new CsvParseError(
                `Row has more than ${limits.maxColumns} columns.`,
                line
            );
        }
    };

    const endRow = (): void => {
        endField();
        rows.push(row);
        row = [];
        rowStarted = false;
        if (rows.length > limits.maxRows) {
            throw new CsvParseError(
                `File has more than ${limits.maxRows} rows.`,
                line
            );
        }
    };

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];

        if (inQuotes) {
            if (char === '"') {
                // A doubled quote is a literal quote; a lone one closes the field.
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                if (char === '\n') line += 1;
                field += char;
            }
            continue;
        }

        if (char === '"' && field === '') {
            inQuotes = true;
        } else if (char === ',') {
            endField();
        } else if (char === '\r' || char === '\n') {
            // Consume CRLF as one boundary.
            if (char === '\r' && source[i + 1] === '\n') i += 1;
            line += 1;
            if (rowStarted || row.length > 0 || field !== '') endRow();
        } else {
            field += char;
            rowStarted = true;
        }
    }

    if (inQuotes) {
        throw new CsvParseError('File ends inside a quoted field.', line);
    }
    if (rowStarted || row.length > 0 || field !== '') endRow();

    return rows;
}
