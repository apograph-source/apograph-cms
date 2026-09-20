/**
 * The text formats Ortha AI may author into the media library, and the MIME
 * type + extension each one stores as.
 *
 * **The model picks a format, never a MIME type.** Handed a free-text
 * `contentType` a model will eventually produce something like
 * `application/x-msdownload`, and `MediaKind.classify` files everything
 * non-audio/video/image/archive under `document` — so an executable would be
 * stored, served by the download route, and look like any other file in the
 * library. A closed enum makes that unrepresentable rather than unlikely.
 *
 * Binary formats (PDF, DOCX, XLSX) are deliberately absent: each needs a
 * renderer, and the content still has to arrive as a tool argument, so they are
 * a separate piece of work rather than three more entries here.
 */
export const FILE_FORMATS = {
    md: {
        mimeType: 'text/markdown',
        extension: 'md',
        label: 'Markdown'
    },
    csv: {
        mimeType: 'text/csv',
        extension: 'csv',
        label: 'CSV'
    },
    html: {
        mimeType: 'text/html',
        extension: 'html',
        label: 'HTML'
    },
    json: {
        mimeType: 'application/json',
        extension: 'json',
        label: 'JSON'
    },
    txt: {
        mimeType: 'text/plain',
        extension: 'txt',
        label: 'Plain text'
    }
} as const;

/** One of the formats {@link FILE_FORMATS} declares. */
export type FileFormat = keyof typeof FILE_FORMATS;

/** The format keys, for a tool's `enum` and for runtime validation. */
export const FILE_FORMAT_NAMES = Object.keys(FILE_FORMATS) as FileFormat[];

/** Whether `value` names a format we can author. */
export function isFileFormat(value: unknown): value is FileFormat {
    return (
        typeof value === 'string' &&
        Object.hasOwn(FILE_FORMATS, value) &&
        // `hasOwn` over a plain object literal is already prototype-safe, but
        // the list is the thing the tool schema advertises — keep them equal.
        (FILE_FORMAT_NAMES as string[]).includes(value)
    );
}

/**
 * Longest file name we will build. Matches `FileName`'s own bound, checked here
 * so an over-long name fails as a legible tool error the model can shorten and
 * retry, rather than as a domain error raised after a human approved it.
 */
export const MAX_FILE_NAME_LENGTH = 255;

/** Raised when a proposed file name cannot be stored as given. */
export class InvalidProposedFileNameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidProposedFileNameError';
    }
}

/** Every extension this module owns, lower-cased, for the strip below. */
const OWNED_EXTENSIONS: readonly string[] = FILE_FORMAT_NAMES.map(
    (name) => FILE_FORMATS[name].extension
);

/**
 * Normalises a model-supplied file name to a storable leaf name carrying the
 * extension its `format` implies.
 *
 * Two rules, both of which exist because of how a model actually behaves:
 *
 * - **A path is rejected, not silently flattened.** Asked for a report a model
 *   will happily propose `reports/2026/q3.md`, and `FileName` rejects
 *   separators so a name can't smuggle traversal into a storage key. Quietly
 *   dropping the directories would file the report at the workspace root while
 *   the model told the user it went to `reports/2026` — so this throws instead,
 *   and the message names the folder parameter that does the job properly.
 * - **The extension follows from `format`.** An extension this module owns is
 *   stripped and replaced, so `summary.txt` proposed as `md` becomes
 *   `summary.md` rather than `summary.txt.md`. An extension it does not own is
 *   left alone (`2026.q3` keeps its `.q3` and gains `.md`), because it is far
 *   more likely to be part of the name than a claim about the contents.
 */
export function resolveFileName(raw: string, format: FileFormat): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new InvalidProposedFileNameError('The file needs a name.');
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        throw new InvalidProposedFileNameError(
            `"${trimmed}" is a path, not a file name. Pass a plain name and use folderId to choose the folder.`
        );
    }

    const { extension } = FILE_FORMATS[format];
    const stem = stripOwnedExtension(trimmed);
    const named = `${stem}.${extension}`;

    if (named.length > MAX_FILE_NAME_LENGTH) {
        throw new InvalidProposedFileNameError(
            `That file name is too long — ${MAX_FILE_NAME_LENGTH} characters at most, including the ".${extension}".`
        );
    }
    return named;
}

/**
 * Drops a trailing extension this module owns, leaving everything else intact.
 * A name that is *only* an extension (`.md`) keeps it as the stem — there is no
 * name left otherwise, and `.md.md` is a better failure than an empty one.
 */
function stripOwnedExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) {
        return name;
    }
    const suffix = name.slice(dot + 1).toLowerCase();
    return OWNED_EXTENSIONS.includes(suffix) ? name.slice(0, dot) : name;
}
