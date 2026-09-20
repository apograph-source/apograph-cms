/**
 * The OpenAPI schemas the transfer plugin contributes.
 *
 * Everything an export or import route answers is a framework-free `interface`
 * in `@orthacms/transfer-domain` — `ExportPreview`, `ImportPreview`,
 * `ImportResult` — which the swagger scanner cannot see and ADR-0003 forbids
 * decorating. So the shapes are written out here.
 *
 * The three enumerations (`action`, `reason`, and the export formats) are
 * **derived from the domain constants**, not retyped: a new
 * {@link IMPORT_REASON} lands in the document the moment it is added, which is
 * the difference between a description that stays true and one that rots.
 */

import {
    IMPORT_ACTION,
    IMPORT_REASON,
    TRANSFER_FORMAT_CAPABILITIES,
    TRANSFER_FORMATS
} from '@orthacms/transfer-domain';
import type { OpenApiSchema } from './openapi-writer';

/** Schema name of the export dry run's answer. */
export const EXPORT_PREVIEW_SCHEMA = 'TransferExportPreview';
/** Schema name of one record's verdict. */
export const IMPORT_VERDICT_SCHEMA = 'TransferImportVerdict';
/** Schema name of a run's totals. */
export const IMPORT_COUNTS_SCHEMA = 'TransferImportCounts';
/** Schema name of an import run's whole answer, dry or applied. */
export const IMPORT_REPORT_SCHEMA = 'TransferImportReport';

/** A non-negative whole number — every count and byte total here is one. */
function count(description: string): OpenApiSchema {
    return { type: 'integer', minimum: 0, description };
}

/** What an export would carry. */
function exportPreviewSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Export preview',
        description:
            'What an export **would** carry, computed by running the same graph walk the export runs and throwing the records away. A preview computed a cheaper way would eventually disagree with the thing it previews.',
        properties: {
            roots: count(
                'Records the caller selected, plus their locale siblings.'
            ),
            related: count('Records pulled in by a relation. One hop only.'),
            assets: count('Distinct assets referenced.'),
            assetBytes: count(
                'Total asset bytes, whether or not the chosen format carries them.'
            ),
            carriesFileBytes: {
                type: 'boolean',
                description:
                    'Whether the chosen format will actually carry `assetBytes`. True only for `zip` with `depth.media` on — so the dialog can say "9 files (metadata only)" rather than implying a download that size.'
            }
        },
        required: [
            'roots',
            'related',
            'assets',
            'assetBytes',
            'carriesFileBytes'
        ],
        additionalProperties: false
    };
}

/** Totals across an import run. */
function importCountsSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Import counts',
        description:
            'Totals across the run — what a dialog shows above the per-record list.',
        properties: {
            create: count('Records that would be, or were, created.'),
            update: count('Records that would be, or were, updated.'),
            skip: count(
                'Records left alone — a conflict the policy says to skip, or a related record linked to an existing row.'
            ),
            error: count('Records that could not be applied.'),
            assetsNew: count('Assets whose bytes would be uploaded.'),
            assetsReused: count(
                'Assets matched by checksum to something the workspace already holds.'
            )
        },
        required: [
            'create',
            'update',
            'skip',
            'error',
            'assetsNew',
            'assetsReused'
        ],
        additionalProperties: false
    };
}

/** One record's verdict. */
function importVerdictSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Import verdict',
        description:
            'What the run decided about one record. The vocabulary is shared by both phases, so a preview cannot describe a decision the apply pass would make differently.',
        properties: {
            $type: {
                type: 'string',
                description: 'Content type name the record belongs to.'
            },
            $id: {
                type: 'string',
                description:
                    'The record’s id **in the source document**, so a verdict traces back to the line that produced it. It is not necessarily an id in this installation.'
            },
            label: {
                type: 'string',
                description:
                    'How to name this record to a person — the first key value, or the first text field, or the source id as a last resort.'
            },
            locale: {
                type: 'string',
                description: 'Locale slug, on a row of a localized type.'
            },
            action: {
                type: 'string',
                enum: Object.values(IMPORT_ACTION),
                description: 'What the run decided to do with the record.'
            },
            reason: {
                type: 'string',
                enum: Object.values(IMPORT_REASON),
                description:
                    'Why it got that action. A stable code rather than a sentence: the admin owns the wording and its translations, the server owns the fact.'
            },
            targetId: {
                type: 'string',
                format: 'uuid',
                description: 'The existing row this matched, when one did.'
            },
            unresolved: {
                type: 'array',
                items: { type: 'string' },
                description:
                    'References that resolved to nothing, as `type:key` strings. Reported rather than fatal — a link that cannot be made is a missing link, not a reason to refuse the record carrying it.'
            },
            issues: {
                type: 'array',
                items: { type: 'string' },
                description:
                    'Validation messages, when `reason` is `validation-failed`.'
            }
        },
        required: ['$type', '$id', 'label', 'action', 'reason'],
        additionalProperties: false
    };
}

/**
 * An import run's whole answer.
 *
 * **One schema for both routes.** The apply route's declared TypeScript return
 * type is the narrower `ImportResult`, but both routes run the one pipeline and
 * return the object it produces, so `version` and `hasChanges` are on the wire
 * either way — verified against a live server. Describing the apply route with
 * the narrower shape would be describing the type rather than the API.
 */
function importReportSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Import report',
        description:
            'What an import did, or — from the preview route — what it would do. The two routes take the same file and the same options and differ by one flag, because they run the same pipeline: what the dry run showed is what the apply does.',
        properties: {
            version: {
                type: 'integer',
                description:
                    'Document format version, echoed so a mismatch is visible up front.'
            },
            counts: { $ref: `#/components/schemas/${IMPORT_COUNTS_SCHEMA}` },
            verdicts: {
                type: 'array',
                items: {
                    $ref: `#/components/schemas/${IMPORT_VERDICT_SCHEMA}`
                },
                description: 'One entry per record in the document.'
            },
            hasChanges: {
                type: 'boolean',
                description:
                    'Whether anything at all would change. A run of pure skips is not an error, but offering "Import" for it would be a lie.'
            }
        },
        required: ['version', 'counts', 'verdicts', 'hasChanges'],
        additionalProperties: false
    };
}

/**
 * The content types an export download can answer with, keyed by media type.
 *
 * Derived from {@link TRANSFER_FORMAT_CAPABILITIES} rather than listed, and it
 * is a **set** rather than one entry because the response's content type is
 * chosen at request time: `format` picks it, and `csv` is promoted to
 * `application/zip` — a ZIP of one CSV per type — whenever the export reaches
 * more than one type, which any `depth.relations` export does. Measured against
 * a live server: the same `format: "csv"` request answers `text/csv` with
 * relations off and `application/zip` with them on.
 */
export function exportDownloadContent(): Record<string, OpenApiSchema> {
    const binary: OpenApiSchema = { type: 'string', format: 'binary' };
    return Object.fromEntries(
        TRANSFER_FORMATS.map((format) => [
            TRANSFER_FORMAT_CAPABILITIES[format].mimeType,
            binary
        ])
    );
}

/** Every schema this plugin adds, keyed by schema name. */
export function buildTransferSchemas(): Record<string, OpenApiSchema> {
    return {
        [EXPORT_PREVIEW_SCHEMA]: exportPreviewSchema(),
        [IMPORT_COUNTS_SCHEMA]: importCountsSchema(),
        [IMPORT_VERDICT_SCHEMA]: importVerdictSchema(),
        [IMPORT_REPORT_SCHEMA]: importReportSchema()
    };
}
