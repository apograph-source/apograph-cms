/**
 * Decorator-free entry point: just the definition DSL and its types.
 *
 * Collection files (and the host's drizzle-kit schema entry that imports
 * them) MUST import from `@orthacms/content-server/define`, not the main
 * barrel — drizzle-kit bundles the schema's whole import graph with plain
 * esbuild, which rejects the NestJS decorators the main barrel pulls in
 * via its controllers.
 */

export { collection, single, joinTableOf } from './lib/collection/define';
export { field } from './lib/fields';

// The one fixed (non per-type) content table: the generic revision store. It is
// HOST-owned like every generated `content_<name>` table — surfaced here (the
// decorator-free barrel) so the host's drizzle-kit schema entry can re-export it
// into the migration diff without pulling in the NestJS main barrel.
export { contentEntryRevisions } from './lib/revisions/infrastructure/persistence/revision-table';

export { CONTENT_TYPE_KIND } from './lib/types/content-type';
export type {
    AnyContentType,
    ContentType,
    ContentTypeKind,
    ContentTypeOptions,
    EntryEnvelope,
    InferEntry,
    InferValues,
    SingleOptions
} from './lib/types/content-type';
export { CONTENT_FIELD_TYPE } from './lib/types/fields';
export type {
    AdminProps,
    AnyFieldSpec,
    BaseFieldOptions,
    FieldSpec,
    FieldType,
    FieldValidation,
    FieldValue,
    RelationFieldOptions,
    RelationOnDelete,
    RelationSpec
} from './lib/types/fields';
