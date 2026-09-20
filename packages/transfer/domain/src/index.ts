/**
 * Public API of `@orthacms/transfer-domain` — the transfer **kernel**.
 *
 * Pure TypeScript (no NestJS, no Drizzle, no React): the document contract both
 * ends of a transfer must agree on, the format implementations, and the
 * identity rules an import matches on. The server package holds everything that
 * touches a database or a byte stream; the admin package imports the same
 * vocabulary so its dialogs describe exactly what the server will do.
 */

export {
    TRANSFER_FORMAT_VERSION,
    NO_DEPTH,
    DEFAULT_DEPTH,
    resolveDepth,
    keyFingerprint,
    isCompleteKey
} from './lib/document/transfer-document';
export type {
    TransferAssetRef,
    TransferAssetTrack,
    TransferCounts,
    TransferDepth,
    TransferDepthLevel,
    TransferDocument,
    TransferManifest,
    TransferRecord,
    TransferRef
} from './lib/document/transfer-document';

export {
    fieldOf,
    mediaFields,
    owningRelationFields
} from './lib/schema/type-schema';
export type {
    TransferFieldSchema,
    TransferSchemas,
    TransferTypeSchema
} from './lib/schema/type-schema';

export {
    IDENTITY_SOURCE,
    naturalKeyOf,
    resolveIdentityFields
} from './lib/identity/natural-key';
export type {
    IdentityResolution,
    IdentitySource
} from './lib/identity/natural-key';

export {
    TRANSFER_FORMAT,
    TRANSFER_FORMATS,
    TRANSFER_FORMAT_CAPABILITIES,
    isTransferFormat
} from './lib/formats/format';
export type {
    TransferFormat,
    TransferFormatCapabilities
} from './lib/formats/format';

export { TransferParseError } from './lib/formats/ports';
export type {
    ExportSerializer,
    ImportParser,
    ParseContext,
    ParseLimits,
    SerializeContext,
    TransferFile
} from './lib/formats/ports';

export {
    EXPORT_SERIALIZERS,
    IMPORT_PARSERS,
    formatFromFilename,
    parserFor,
    serializerFor
} from './lib/formats/registry';
export {
    ASSETS_DIR,
    ENTRIES_DIR,
    MANIFEST_PATH
} from './lib/formats/zip-format';

export { CsvParseError, encodeCsv, parseCsv } from './lib/csv/csv';
export {
    ENVELOPE_COLUMNS,
    csvColumns,
    formatRefToken,
    parseRefToken,
    recordToRow,
    rowToRecord
} from './lib/csv/flatten';

export {
    RESOLVED_VIA,
    TransferAssetMap,
    TransferIdMap
} from './lib/import/id-map';
export type { RefResolution, ResolvedVia } from './lib/import/id-map';

export {
    CONFLICT_POLICIES,
    CONFLICT_POLICY,
    IMPORT_ACTION,
    IMPORT_REASON,
    RELATION_POLICIES,
    RELATION_POLICY,
    countVerdict,
    emptyCounts,
    hasChanges
} from './lib/import/verdict';
export type {
    ConflictPolicy,
    ImportAction,
    ImportCounts,
    ImportPreview,
    ImportReason,
    ImportResult,
    ImportVerdict,
    RelationPolicy
} from './lib/import/verdict';

export {
    DEFAULT_TRANSFER_LIMITS,
    TransferLimitError,
    resolveLimits
} from './lib/limits';
export type { TransferLimits } from './lib/limits';
