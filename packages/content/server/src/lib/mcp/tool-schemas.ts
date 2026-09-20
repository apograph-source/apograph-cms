import type { JsonSchema } from '@orthacms/tools-server';
import {
    BULK_MAX_IDS,
    BULK_MAX_SAVE_ITEMS,
    DEFAULT_PAGE_SIZE,
    FILTER_MAX_LENGTH,
    MAX_PAGE_SIZE
} from '../entries/entries.constants';
import { ENTRY_VISIBILITY } from '../public-api/http/dto/public-list-entries-query.dto';

/**
 * JSON Schemas for the content tools' arguments.
 *
 * **Hand-written and generic**, not generated per content type — the single
 * most consequential shape decision in this surface. An MCP client loads every
 * tool's schema into the model's context on connect, so generating
 * `article_create`, `author_create`, `tag_create`… would put the entire content
 * model in the prompt of every conversation and scale the cost with the number
 * of collections. It could not even be a fixed set: the visible types depend on
 * the calling token's workspace grants.
 *
 * So the tools take `typeName` as an argument, exactly as the HTTP routes take
 * it as a path segment, and a model **discovers** the shape it needs with
 * `content_type_get` — one type, on demand. That is why every `values`
 * parameter below is an open object whose description points at the discovery
 * tool rather than an inline schema.
 *
 * These are the schemas for the *arguments*; the per-type field schemas
 * `content_type_get` returns are generated from the registry by
 * `docs/field-schema.ts`, which already produces them for the OpenAPI document.
 */

/** `typeName`, on every tool. */
const TYPE_NAME: JsonSchema = {
    type: 'string',
    description:
        'Machine name of the content type, e.g. `article`. Call `content_types_list` for the names this workspace exposes.'
};

/** The two ways to name one entry. */
const LOCATOR: Record<string, JsonSchema> = {
    id: {
        type: 'string',
        format: 'uuid',
        description: 'The entry id. Pass this **or** `localeGroupId`, not both.'
    },
    localeGroupId: {
        type: 'string',
        format: 'uuid',
        description:
            'The entry’s translation group id, resolved together with `locale`. Use this when you track a record across languages — the group id is stable, each locale’s `id` is not.'
    }
};

/** `locale`, wherever a localized type can be addressed. */
const LOCALE: JsonSchema = {
    type: 'string',
    maxLength: 35,
    description:
        'Locale slug (e.g. `en`). Absent means the default locale. Ignored on types that are not localized.'
};

/** The publish-state filter, gated on write scope for anything but the default. */
const STATUS: JsonSchema = {
    type: 'string',
    enum: [...ENTRY_VISIBILITY],
    description:
        'Publish states to return. `published` (the default) is all a read-only token may ask for; `draft` and `any` need write scope. Use `any` after creating an entry — a new entry is a draft and the default would not find it.'
};

/** Sparse fieldsets — the main lever on how much context a result costs. */
const FIELDS: JsonSchema = {
    type: 'string',
    description:
        'Comma-separated field names to return in `values`, e.g. `title,slug`. Absent returns every field, which on a type with rich text can be very large — prefer naming the fields you need.'
};

/** Relation/media/translation expansion, shared by the single-entry reads. */
const EXPANSIONS: Record<string, JsonSchema> = {
    relations: {
        type: 'string',
        enum: ['preview'],
        description:
            'Set to `preview` to expand the relation fields named in `relationFields`.'
    },
    relationFields: {
        type: 'string',
        description:
            'Comma-separated relation fields to expand, e.g. `author,tags`. Ignored without `relations=preview`.'
    },
    media: {
        type: 'string',
        enum: ['preview'],
        description:
            'Set to `preview` to expand the media fields named in `mediaFields`.'
    },
    mediaFields: {
        type: 'string',
        description:
            'Comma-separated media fields to expand. Ignored without `media=preview`.'
    },
    translations: {
        type: 'string',
        enum: ['preview'],
        description:
            'Set to `preview` to attach the entry’s sibling translations. An error on a type that is not localized.'
    },
    relationLimit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
        description: `Links per expanded relation field (1…${MAX_PAGE_SIZE}). The field's \`total\` always reports the true count.`
    },
    mediaLimit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
        description: `Assets per expanded media field (1…${MAX_PAGE_SIZE}).`
    }
};

/** An object schema with no extra keys allowed. */
function object(
    properties: Record<string, JsonSchema>,
    required: string[] = []
): JsonSchema {
    return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false
    };
}

/** `content_types_list` — no arguments. */
export const LIST_TYPES_SCHEMA: JsonSchema = object({});

/** `content_type_get` */
export const GET_TYPE_SCHEMA: JsonSchema = object({ typeName: TYPE_NAME }, [
    'typeName'
]);

/** `content_list` */
export const LIST_ENTRIES_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        search: {
            type: 'string',
            maxLength: 255,
            description:
                'Free-text, case-insensitive search across the type’s text-like columns.'
        },
        filter: {
            type: 'string',
            maxLength: FILTER_MAX_LENGTH,
            description:
                'Structured filter tree as a JSON **string**, e.g. `{"and":[{"field":"featured","op":"eq","value":true}]}`. Filterable: the type’s scalar fields plus `id`, `createdAt`, `updatedAt`, `publishedAt`, and on localized types `locale` and `localeGroupId`.'
        },
        sort: {
            type: 'string',
            description:
                'A field name for ascending, `-`-prefixed for descending, e.g. `-publishedAt`. Defaults to newest-updated first.'
        },
        page: {
            type: 'integer',
            minimum: 1,
            description: '1-based page number.'
        },
        pageSize: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PAGE_SIZE,
            description: `Rows per page (1…${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}). Keep it small — every row costs context.`
        },
        fields: FIELDS,
        locale: LOCALE,
        status: STATUS
    },
    ['typeName']
);

/** `content_get` */
export const GET_ENTRY_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        fields: FIELDS,
        locale: LOCALE,
        status: STATUS,
        ...EXPANSIONS
    },
    ['typeName']
);

/** `content_relations` */
export const RELATIONS_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        field: {
            type: 'string',
            description: 'The relation field to page, e.g. `tags`.'
        },
        page: { type: 'integer', minimum: 1, description: '1-based page.' },
        pageSize: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PAGE_SIZE,
            description: `Links per page (1…${MAX_PAGE_SIZE}).`
        },
        locale: LOCALE,
        status: STATUS
    },
    ['typeName', 'field']
);

/** `content_media` */
export const MEDIA_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        locale: LOCALE,
        status: STATUS,
        mediaLimit: EXPANSIONS['mediaLimit']
    },
    ['typeName']
);

/** `content_translations` */
export const TRANSLATIONS_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        fields: FIELDS,
        locale: LOCALE,
        status: STATUS
    },
    ['typeName']
);

/** The `values` bag — open, because its real shape is per content type. */
const VALUES: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    description:
        'Field values keyed by field name. The accepted shape is the content type’s own — call `content_type_get` first to see it. A media field takes asset ids; an owning single relation takes the target’s entry id.'
};

/** Relation deltas — assign/unassign, shared by create and update. */
const RELATION_DELTAS: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    description:
        'Relation changes keyed by relation field: `{"tags":{"link":["<id>"],"unlink":["<id>"]}}`. A delta, not a replacement — ids you do not mention are left alone. Many-to-many and inverse relations only; set an owning single relation through `values`. Add `"by":"localeGroup"` to pass translation-group ids instead of entry ids.'
};

/** `content_create` */
export const CREATE_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        values: VALUES,
        relations: RELATION_DELTAS,
        locale: {
            ...LOCALE,
            description:
                'Locale the new row is written in. Absent means the default locale.'
        },
        localeGroupId: {
            type: 'string',
            format: 'uuid',
            description:
                'Join an existing translation group — this is how you add a language to a record that already exists. Take `localeGroupId` off any read and pass it with a different `locale`.'
        }
    },
    ['typeName', 'values']
);

/** `content_update` */
export const UPDATE_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        values: {
            ...VALUES,
            description:
                'Fields to change. A **partial** update: omitted fields are left alone, and an explicit `null` clears one. You do not need to send the whole record.'
        },
        relations: RELATION_DELTAS,
        locale: LOCALE
    },
    ['typeName', 'values']
);

/** `content_publish` / `content_unpublish` / `content_delete` */
export const ENTRY_ACTION_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ...LOCATOR,
        locale: LOCALE
    },
    ['typeName']
);

/**
 * `content_bulk_save` — the batch form of create + update.
 *
 * One `items` array rather than a `creates` and an `updates` list: a model
 * working from a list of records knows which ones it read an id for and which
 * it did not, and asking it to partition them first is a step it can get wrong
 * for no benefit. The addressing inside an item is the same addressing the
 * single-entry tools take as top-level arguments.
 */
export const BULK_SAVE_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        items: {
            type: 'array',
            minItems: 1,
            maxItems: BULK_MAX_SAVE_ITEMS,
            description: `The entries to save (1…${BULK_MAX_SAVE_ITEMS}), applied in order. Every item is reported back at the same position, so a partial batch is legible.`,
            items: object({
                id: {
                    type: 'string',
                    format: 'uuid',
                    description:
                        'The entry to update. Omit to create a new one.'
                },
                op: {
                    type: 'string',
                    enum: ['create', 'update'],
                    description:
                        'What this item does. Inferred from the addressing — an `id` means update, no `id` and no `localeGroupId` means create — and required only when you pass `localeGroupId` alone, which could mean either adding that record’s row in `locale` or changing the row it already has there.'
                },
                values: VALUES,
                relations: RELATION_DELTAS,
                locale: LOCALE,
                localeGroupId: {
                    type: 'string',
                    format: 'uuid',
                    description:
                        'The translation group this row belongs to — joined on a create, addressed together with `locale` on an update.'
                }
            })
        }
    },
    ['typeName', 'items']
);

/** `content_bulk_publish` / `content_bulk_unpublish` / `content_bulk_delete`. */
export const BULK_IDS_SCHEMA: JsonSchema = object(
    {
        typeName: TYPE_NAME,
        ids: {
            type: 'array',
            minItems: 1,
            maxItems: BULK_MAX_IDS,
            items: { type: 'string', format: 'uuid' },
            description: `Entry ids to act on (1…${BULK_MAX_IDS}). Ids from another workspace, or that never existed, simply do not match — they are not an error.`
        }
    },
    ['typeName', 'ids']
);
