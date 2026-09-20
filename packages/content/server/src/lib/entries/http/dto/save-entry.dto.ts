import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength
} from 'class-validator';
import type { RelationDelta } from '../../types/entry-list-view';
import {
    IsRelationDeltaMap,
    MAX_DELTA_FIELDS,
    MAX_DELTA_IDS
} from './relation-delta-map.validator';
import {
    MAX_EXTENSION_KEYS,
    MaxExtensionKeys
} from './extension-bag.validator';

/** Longest accepted locale slug (BCP-47's practical bound). */
const LOCALE_MAX_LENGTH = 35;

/** OpenAPI schema of one uuid-array leg of a relation delta. */
const UUID_ARRAY_SCHEMA = {
    type: 'array',
    maxItems: MAX_DELTA_IDS,
    items: { type: 'string', format: 'uuid' }
} as const;

/**
 * Body for `POST /api/content/:typeName` (create) and
 * `PATCH /api/content/:typeName/:id` (update). The field `values` bag crosses the
 * wire, plus optional per-field relation **deltas** (`relations`) — the editor
 * stages its many-to-many / inverse link changes locally and sends them here
 * with the rest of the document, so a save persists everything in **one
 * transaction** without ever transmitting a huge relation whole.
 *
 * Reserved envelope columns (`status`/`published_at`/`deleted_at`) are owned by
 * the service and can't be set from here: `coerceValues`/`toColumns` project
 * only keys declared on the type, so a reserved (or otherwise unknown) key in
 * the bag is **silently dropped** — including before validation, which runs on
 * the coerced bag, so an unknown key is never a 422 on either kind of type.
 * (That is what keeps an old revision snapshot restorable after its field was
 * removed from the type.) The bag's
 * *contents* are validated against the type's field specs by that same service
 * (a dynamic, per-type contract class-validator can't express); the relation
 * deltas' ids are validated as existing workspace entries by
 * `RelationLinkService`. `values` is structurally only "an object" (its contents
 * are the per-type contract); the `relations` bag's *shape* — each value a
 * `{ link?, unlink?, order? }` of uuid arrays — is enforced here so a malformed
 * delta is a clean 400, not a 500 from a bad id hitting the query.
 */
export class SaveEntryDto {
    /** Field values keyed by field name. */
    @ApiProperty({
        type: 'object',
        additionalProperties: true,
        example: { title: 'Hello world', author: null },
        description:
            "Field values keyed by field name — the per-type contract, so this is structurally just an object. Contents are validated against the content type's field specs (a failure is a 422 carrying per-field issues). Reserved envelope keys (`status`, `publishedAt`, `deletedAt`, `locale`, `localeGroupId`) are not settable here."
    })
    @IsObject()
    values!: Record<string, unknown>;

    /**
     * Per-field relation deltas (`{ <field>: { link?, unlink?, order? } }`) —
     * many/inverse relations only; a single relation is set through `values`.
     */
    @ApiPropertyOptional({
        type: 'object',
        maxProperties: MAX_DELTA_FIELDS,
        additionalProperties: {
            type: 'object',
            properties: {
                link: UUID_ARRAY_SCHEMA,
                unlink: UUID_ARRAY_SCHEMA,
                order: UUID_ARRAY_SCHEMA
            },
            additionalProperties: false
        },
        example: {
            tags: {
                link: ['9c4b1e77-2f0a-4d3b-8e6c-1a5f7b2d9e04'],
                unlink: []
            }
        },
        description: `Per-field relation deltas, keyed by relation field. Many-to-many and inverse relations only — a single relation is set through \`values\`, and naming one here is a 400. At most ${MAX_DELTA_FIELDS} fields per save and ${MAX_DELTA_IDS} ids per array; \`order\` is accepted on the owning side only.`
    })
    @IsOptional()
    @IsObject()
    @IsRelationDeltaMap()
    relations?: Record<string, RelationDelta>;

    /**
     * Locale slug the entry is created in — an **extension-owned** param this
     * package declares but never interprets (forwarded to the bound
     * `CONTENT_ENTRY_EXTENSION`, which validates it and stamps the envelope
     * column). Read on create only; an update never re-homes a row's locale.
     */
    @ApiPropertyOptional({
        type: String,
        maxLength: LOCALE_MAX_LENGTH,
        example: 'de',
        description:
            'Locale slug the entry is created in. Extension-owned: forwarded to the bound `CONTENT_ENTRY_EXTENSION`, which validates it and stamps the envelope column. Read on create only — an update never re-homes a row’s locale.'
    })
    @IsOptional()
    @IsString()
    @MaxLength(LOCALE_MAX_LENGTH)
    locale?: string;

    /**
     * The existing translation group a created row joins (making it a sibling)
     * — an **extension-owned**, opaque param, like {@link locale}. Absent → the
     * row starts its own fresh group. The bound extension validates it against
     * the workspace. Read on create only.
     */
    @ApiPropertyOptional({
        type: String,
        format: 'uuid',
        description:
            'The existing translation group a created row joins, making it a sibling. Absent → the row starts its own fresh group. Validated against the workspace by the bound extension (unknown group → 404; duplicate locale in the group → 409). Read on create only.'
    })
    @IsOptional()
    @IsUUID()
    localeGroupId?: string;

    /**
     * State a **different plugin** owns about this entry, keyed by that plugin's
     * extension key — opaque here, exactly like {@link locale}: content-server
     * forwards the bag to the bound entry-write extensions and never looks
     * inside it. `@orthacms/segments-server` reads `access` from it.
     *
     * It rides the save body rather than a second request so the entry, its
     * links, the plugin's state and the version recording all of them commit in
     * one transaction — and so the version records what the save applied instead
     * of what it replaced.
     *
     * A key **omitted** is left alone; a key present is written. An **unknown**
     * key is ignored rather than refused, because the same client may be talking
     * to a deployment without that plugin installed.
     */
    @ApiPropertyOptional({
        type: 'object',
        maxProperties: MAX_EXTENSION_KEYS,
        additionalProperties: true,
        example: { access: { allow: [], deny: [] } },
        description:
            'Per-plugin state stored alongside the entry, keyed by extension (e.g. `access`). Opaque to content-server: forwarded to the bound entry-write extensions, written inside the save’s transaction, and captured by the revision. An omitted key is left unchanged; an unknown key is ignored.'
    })
    @IsOptional()
    @IsObject()
    @MaxExtensionKeys()
    extensions?: Record<string, unknown>;
}
