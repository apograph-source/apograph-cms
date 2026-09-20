/**
 * The response schemas of the i18n plugin's three read routes, as plain
 * OpenAPI objects.
 *
 * They are built rather than reflected because the shapes they describe are
 * TypeScript `interface`s (`LocalesView`, `EntryLocalesView`,
 * `LocaleSummaryView`) — erased at compile time, invisible to
 * `@nestjs/swagger`'s scanner, and impossible to decorate. See
 * `packages/bootstrap/server/AGENTS.md` → "The response-schema gap".
 *
 * Pure: locale slugs in, schema objects out. No document, no Nest, no
 * registry.
 */

import { ENTRY_STATUS } from '@orthacms/content-server';
import { LOCALE_DIR } from '../i18n.constants';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** A `$ref` to one of the schemas registered by {@link buildI18nSchemas}. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

/**
 * The text direction of a locale. Always present on the wire even though it is
 * optional in config: the registry resolves a declared or inferred value before
 * anything is serialized, so no consumer has to decide for itself whether
 * Arabic is right-to-left.
 */
const DIR_SCHEMA: OpenApiSchema = {
    type: 'string',
    enum: [...LOCALE_DIR],
    description:
        'Resolved text direction for content in this locale — the HTML `dir` value to set alongside `lang`.'
};

/**
 * The publish state of one row. Present **only on a publishable content type**,
 * which is why it appears in no `required` list: the services spread
 * `status`/`publishedAt` in conditionally, so on a non-publishable type the keys
 * are absent rather than null.
 */
const STATUS_SCHEMA: OpenApiSchema = {
    type: 'string',
    enum: Object.values(ENTRY_STATUS),
    description:
        'Publish state. Present on publishable content types only — absent, not null, on the rest.'
};

/** When this row last went live, or `null` if it never has. */
const PUBLISHED_AT_SCHEMA: OpenApiSchema = {
    type: 'string',
    format: 'date-time',
    nullable: true,
    description:
        'When this row last went live, or `null` if it never has. Publishable content types only. Paired with `status` it separates a never-published draft from one carrying unpublished edits over live content.'
};

/**
 * The group's row in one locale — the `entry` member of a locale panel item.
 *
 * **Inlined rather than a `$ref`**, because this is the one nullable object in
 * the plugin's responses and OpenAPI 3.0 has no way to spell a nullable
 * reference: every sibling of `$ref` is ignored, so `{ $ref, nullable: true }`
 * reads as if it works and silently drops the null, and `nullable` beside a
 * bare `allOf`/`oneOf` is adjunct to `type` and equally inert. `type: 'object'`
 * with `nullable: true` is the form that actually says what the route returns.
 */
const ENTRY_ROW_SCHEMA: OpenApiSchema = {
    type: 'object',
    nullable: true,
    description:
        'The group’s row in this locale, or `null` when it has not been translated yet. Enough to route to the row and render its state — not its values.',
    properties: {
        id: {
            type: 'string',
            format: 'uuid',
            description: 'The entry id of this locale’s row.'
        },
        status: STATUS_SCHEMA,
        publishedAt: PUBLISHED_AT_SCHEMA,
        updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When this row was last written.'
        }
    },
    required: ['id', 'updatedAt']
};

/**
 * The i18n plugin's response schemas, keyed by component name.
 *
 * `locale` / `slug` carry the **configured** slugs as an enum, which is a fact
 * about every response rather than a guess: the locales route maps the
 * registry, the per-entry panel iterates the configured set, and the batch
 * summary drops any row whose slug the host no longer declares. A locale the
 * config does not name cannot appear in any of the three.
 */
export function buildI18nSchemas(
    localeSlugs: readonly string[]
): Record<string, OpenApiSchema> {
    const slugSchema: OpenApiSchema = {
        type: 'string',
        enum: [...localeSlugs],
        description:
            'A configured locale slug — a BCP-47 language tag, usable verbatim as an HTML `lang` value.'
    };

    return {
        I18nLocale: {
            type: 'object',
            description: 'One configured locale.',
            properties: {
                slug: slugSchema,
                name: {
                    type: 'string',
                    description: 'Human display name, e.g. "English".'
                },
                isDefault: {
                    type: 'boolean',
                    description:
                        'The locale applied when a request names none. Exactly one locale in the list sets it.'
                },
                dir: DIR_SCHEMA
            },
            required: ['slug', 'name', 'isDefault', 'dir']
        },
        I18nLocalesView: {
            type: 'object',
            description:
                'The configured locales, in display order. Every field is resolved server-side, so a client needs no locale table of its own.',
            properties: {
                items: { type: 'array', items: ref('I18nLocale') }
            },
            required: ['items']
        },
        I18nEntryLocaleItem: {
            type: 'object',
            description:
                'One configured locale’s slot in the translation group.',
            properties: {
                locale: slugSchema,
                dir: DIR_SCHEMA,
                isDefault: {
                    type: 'boolean',
                    description:
                        'Whether this is the configured default locale.'
                },
                entry: ENTRY_ROW_SCHEMA
            },
            required: ['locale', 'dir', 'isDefault', 'entry']
        },
        I18nEntryLocalesView: {
            type: 'object',
            description:
                'The locale panel of one entry: every configured locale, in config order, with the group’s row in it or `null`.',
            properties: {
                localeGroupId: {
                    type: 'string',
                    format: 'uuid',
                    description:
                        'The translation group this entry belongs to — the stable identity of the record across languages.'
                },
                items: { type: 'array', items: ref('I18nEntryLocaleItem') }
            },
            required: ['localeGroupId', 'items']
        },
        I18nLocaleSummaryItem: {
            type: 'object',
            description: 'One live member of a translation group.',
            properties: {
                locale: slugSchema,
                entryId: {
                    type: 'string',
                    format: 'uuid',
                    description: 'The member row’s entry id.'
                },
                status: STATUS_SCHEMA,
                publishedAt: PUBLISHED_AT_SCHEMA
            },
            required: ['locale', 'entryId']
        },
        I18nLocaleSummaryView: {
            type: 'object',
            description:
                'Per requested translation-group id, that group’s live members in config order.',
            properties: {
                groups: {
                    type: 'object',
                    description:
                        'Keyed by the group ids the request asked for — **exactly** those, no more and no fewer. A group in another workspace and one that names nothing at all both come back as an empty array, so a caller learns nothing it did not already supply.',
                    additionalProperties: {
                        type: 'array',
                        items: ref('I18nLocaleSummaryItem')
                    }
                }
            },
            required: ['groups']
        }
    };
}
