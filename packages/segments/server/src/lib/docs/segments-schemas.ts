/**
 * The OpenAPI schemas the segments plugin contributes.
 *
 * Every one of these routes answers a framework-free `interface` —
 * `SegmentView`, `SegmentListView`, `EntryAccessView`, `PublicEntryAccess` —
 * which the swagger scanner cannot see and ADR-0003 forbids decorating. So the
 * shapes are written out here.
 *
 * **None of them is content-type-dependent**, which is worth stating because
 * the neighbouring content pass generates a schema trio per registered type and
 * the `/access` routes sit on a `{typeName}` path. What varies with the type
 * there is the *parameter*, not the payload: an entry's audiences are two lists
 * of segment ids whatever the entry is. The parameter's enum comes from
 * content's own pass, which is the only thing holding the registry.
 */

import {
    SEGMENT_KEY_MAX,
    SEGMENT_KEY_PATTERN,
    SEGMENT_LABEL_MAX,
    SEGMENT_TAG_MAX,
    SEGMENT_TAGS_MAX
} from '@orthacms/segments-domain';
import { ENTRY_ACCESS_IDS_MAX } from '../http/segments.dto';
import {
    DEFAULT_PAGE_SIZE,
    MATCHED_IDS_CAP,
    MAX_PAGE_SIZE
} from '../application/segments.service';
import { ref, type OpenApiSchema } from './openapi-writer';

/** Schema name of one segment. */
export const SEGMENT_SCHEMA = 'Segment';
/** Schema name of one page of the directory. */
export const SEGMENT_PAGE_SCHEMA = 'SegmentPage';
/** Schema name of one entry's two lists, as the admin reads them. */
export const ENTRY_ACCESS_SCHEMA = 'EntryAccess';
/** Schema name of the public API's answer for one entry. */
export const PUBLIC_ENTRY_ACCESS_SCHEMA = 'PublicEntryAccess';

/** A list of segment ids, capped the way an entry's own sides are. */
function segmentIds(description: string): OpenApiSchema {
    return {
        type: 'array',
        maxItems: ENTRY_ACCESS_IDS_MAX,
        items: { type: 'string', format: 'uuid' },
        description
    };
}

/** One audience. */
function segmentSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Segment',
        description:
            'One audience: a named set of reader tags. Installation-wide rather than per-workspace — an audience is vocabulary, like a content type, and one copy per workspace would mean renaming a customer in each of them.',
        properties: {
            id: { type: 'string', format: 'uuid', description: 'Segment id.' },
            key: {
                type: 'string',
                maxLength: SEGMENT_KEY_MAX,
                pattern: SEGMENT_KEY_PATTERN.source,
                description:
                    'Stable machine name. What an integration writes; unique per installation.'
            },
            label: {
                type: 'string',
                maxLength: SEGMENT_LABEL_MAX,
                description: 'Display name, for the directory and the editor.'
            },
            tags: {
                type: 'array',
                maxItems: SEGMENT_TAGS_MAX,
                items: { type: 'string', maxLength: SEGMENT_TAG_MAX },
                description:
                    'The reader tags this audience answers to — a reader carrying any of them is in it. This indirection is the point of the feature: an identifier renamed upstream is one row edited here, and every entry naming the segment keeps working. Defaults to `[key]`.'
            },
            workspaceIds: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description:
                    'The workspaces this audience is offered in. **Empty means every one** — it is not "no workspaces".'
            },
            usageCount: {
                type: 'integer',
                minimum: 0,
                description:
                    'How many entries name it, on either side. Answers "is this one actually used?" before a rename or a delete.'
            }
        },
        required: ['id', 'key', 'label', 'tags', 'workspaceIds', 'usageCount'],
        additionalProperties: false
    };
}

/** One page of the directory. */
function segmentPageSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Segment page',
        description: `One page of the audience directory. \`total: 0\` with no filter means nothing is segmented at all: every published entry is readable by everyone, which is the state an installation stays in until somebody creates the first audience. Page size defaults to ${DEFAULT_PAGE_SIZE} and is capped at ${MAX_PAGE_SIZE}.`,
        properties: {
            items: { type: 'array', items: ref(SEGMENT_SCHEMA) },
            total: {
                type: 'integer',
                minimum: 0,
                description: 'Rows matching the filter, across every page.'
            },
            page: { type: 'integer', minimum: 1, description: '1-based.' },
            pageSize: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_PAGE_SIZE,
                description: 'Rows on this page.'
            },
            ids: {
                type: 'array',
                maxItems: MATCHED_IDS_CAP,
                items: { type: 'string', format: 'uuid' },
                description: `**Every** id the filter matched, not only this page's — what the entry editor's "set every audience to…" acts on, so a bulk action means the whole list rather than whichever rows are on screen. Capped at ${MATCHED_IDS_CAP}, deliberately the same number an entry may store on one side.`
            },
            idsTruncated: {
                type: 'boolean',
                description:
                    'Whether `ids` was cut short by the cap — how the editor knows to say so instead of silently doing part of the action.'
            }
        },
        required: ['items', 'total', 'page', 'pageSize', 'ids', 'idsTruncated'],
        additionalProperties: false
    };
}

/** The allow/deny pair, described once and reused by both surfaces. */
const ALLOW = segmentIds(
    'Audience ids that may read the entry. **Empty means everyone** — not nobody. This is the state every entry is in until somebody decides otherwise.'
);
const DENY = segmentIds(
    'Audience ids that may not read it, whatever else admits them. A deny always wins over an allow.'
);

/** One entry's two lists, as the admin routes answer them. */
function entryAccessSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Entry access',
        description:
            'One entry’s two lists. There is no rule object and no inheritance: what an editor sets on the entry is exactly what a reader is matched against on the next request. Two empty lists mean the entry is readable by everyone.',
        properties: { allow: ALLOW, deny: DENY },
        required: ['allow', 'deny'],
        additionalProperties: false
    };
}

/**
 * The public API's answer, which is the admin's plus one derived flag.
 *
 * Not the same schema with an optional field: the two surfaces answer
 * different objects, and describing them as one would be the mistake content's
 * pass documents at length — a public route reported with an admin shape reads
 * as a contract until somebody curls it.
 */
function publicEntryAccessSchema(): OpenApiSchema {
    return {
        type: 'object',
        title: 'Public entry access',
        description:
            'Who may read one entry, over the token-authenticated API. Read from this plugin’s own table rather than through the public entry read — that read is reader-scoped, so a client that had just restricted an entry would otherwise be unable to read back what it had done, the restriction it wrote being the thing hiding it.',
        properties: {
            entryId: {
                type: 'string',
                format: 'uuid',
                description:
                    'The entry asked about. On a localized type the answer covers the whole record: every language of it carries the same audiences.'
            },
            restricted: {
                type: 'boolean',
                description:
                    'Whether anybody has decided about it at all — `true` when either list is non-empty. Derived, not stored.'
            },
            allow: ALLOW,
            deny: DENY
        },
        required: ['entryId', 'restricted', 'allow', 'deny'],
        additionalProperties: false
    };
}

/** Every schema this plugin adds, keyed by schema name. */
export function buildSegmentsSchemas(): Record<string, OpenApiSchema> {
    return {
        [SEGMENT_SCHEMA]: segmentSchema(),
        [SEGMENT_PAGE_SCHEMA]: segmentPageSchema(),
        [ENTRY_ACCESS_SCHEMA]: entryAccessSchema(),
        [PUBLIC_ENTRY_ACCESS_SCHEMA]: publicEntryAccessSchema()
    };
}
