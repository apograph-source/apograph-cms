/**
 * The content-insights pass over the host's OpenAPI document.
 *
 * Six widgets, six **unlike** payloads. They share a prefix and nothing else:
 * one is a stat tile with two sparklines, one a sparse 7×24 grid, one a fixed
 * set of age buckets, one a time series with a self-describing bucket width.
 * Reading a family resemblance into them and describing them from one schema is
 * how a document ends up confidently wrong, so each is written out.
 *
 * Separate from `docs/describe-content-api.ts` because it describes a separate
 * surface: `/insights/*` is grouped under its own `insights` tag in the
 * reference (the host tags by first route segment), and the widgets are read by
 * the Insights page rather than by anything reading content.
 *
 * Pure: it takes the document and mutates only these six operations.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { OpenApiSchema } from '../../docs/field-schema';
import { ref } from '../../docs/content-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** The bucket widths a series picks from, by window length. */
const GRANULARITY: OpenApiSchema = {
    type: 'string',
    enum: ['day', 'week', 'month'],
    description:
        'Chosen from the window, not requested: up to 31 days is `day`, up to 120 is `week`, longer is `month`. A year grouped by day would be 365 points for a sparkline 64 pixels wide.'
};

/** One point on a time series. */
const SERIES_POINT: OpenApiSchema = {
    type: 'object',
    required: ['bucket', 'value'],
    properties: {
        bucket: {
            type: 'string',
            description: 'Bucket start, `YYYY-MM-DD`. The client formats it.',
            example: '2026-09-04'
        },
        value: { type: 'integer' }
    }
};

/**
 * The headline counts.
 *
 * There is deliberately no `draftsDelta` beside the other two: a draft's count
 * changes when a row is *published*, and a row that moved back to draft leaves
 * no trace on the collection table. Reporting one would mean inventing it.
 */
const TOTALS: OpenApiSchema = {
    type: 'object',
    required: [
        'entries',
        'published',
        'drafts',
        'entriesDelta',
        'publishedDelta',
        'entriesHistory',
        'publishedHistory'
    ],
    properties: {
        entries: {
            type: 'integer',
            description: 'Every non-deleted entry in the workspace.'
        },
        published: { type: 'integer', description: 'Entries currently live.' },
        drafts: { type: 'integer', description: 'Entries currently in draft.' },
        entriesDelta: {
            type: 'integer',
            description: 'Entries created within the window.'
        },
        publishedDelta: {
            type: 'integer',
            description: 'Entries first published within the window.'
        },
        entriesHistory: {
            type: 'array',
            items: { type: 'integer' },
            description:
                'Cumulative entry count across the window, oldest bucket first — the sparkline.'
        },
        publishedHistory: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Cumulative published count, oldest bucket first.'
        }
    }
};

/** Draft/published split per content type. */
const PIPELINE: OpenApiSchema = {
    type: 'object',
    required: ['types'],
    properties: {
        types: {
            type: 'array',
            description:
                'One row per type that has at least one entry, biggest first. A type the workspace has never used is omitted, not listed at zero.',
            items: {
                type: 'object',
                required: ['name', 'label', 'published', 'drafts'],
                properties: {
                    name: { type: 'string' },
                    label: { type: 'string' },
                    published: { type: 'integer' },
                    drafts: { type: 'integer' }
                }
            }
        }
    }
};

/** Entries published per bucket. */
const VELOCITY: OpenApiSchema = {
    type: 'object',
    required: ['points', 'granularity'],
    properties: {
        points: {
            type: 'array',
            items: SERIES_POINT,
            description: 'Oldest bucket first.'
        },
        granularity: GRANULARITY
    }
};

/**
 * Editing activity by weekday and hour.
 *
 * Only non-empty cells come back — a full grid is 168 of them and most are
 * zero — so `max` travels with them: recomputing the busiest value from a
 * sparse list gives the wrong denominator whenever the grid is empty.
 */
const PUNCHCARD: OpenApiSchema = {
    type: 'object',
    required: ['cells', 'max', 'total'],
    properties: {
        cells: {
            type: 'array',
            description: 'The non-empty slots only; the client fills the gaps.',
            items: {
                type: 'object',
                required: ['weekday', 'hour', 'count'],
                properties: {
                    weekday: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 7,
                        description: 'ISO weekday: 1 = Monday … 7 = Sunday.'
                    },
                    hour: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 23,
                        description:
                            'Hour of day in the database session’s timezone (UTC).'
                    },
                    count: {
                        type: 'integer',
                        description: 'Revisions written in that slot.'
                    }
                }
            }
        },
        max: {
            type: 'integer',
            description:
                'The busiest cell’s count, or 0 when there is no activity.'
        },
        total: { type: 'integer', description: 'Revisions across the window.' }
    }
};

/**
 * Published entries by how long ago they were last edited.
 *
 * The five buckets are fixed and always all present, in this order, zeros
 * included — the query builds them from a constant table rather than from what
 * it found — so they are an enum rather than a free string.
 */
const STALE: OpenApiSchema = {
    type: 'object',
    required: ['buckets', 'total'],
    properties: {
        buckets: {
            type: 'array',
            description:
                'Always these five, freshest first, whether or not they hold anything. Only live content is counted: an untouched draft is a draft, not a neglected page.',
            items: {
                type: 'object',
                required: ['id', 'count'],
                properties: {
                    id: {
                        type: 'string',
                        enum: ['d30', 'd90', 'd180', 'd365', 'older'],
                        description:
                            'Age band of the last edit, in days: up to 30, up to 90, up to 180, up to 365, then everything older.'
                    },
                    count: { type: 'integer' }
                }
            }
        },
        total: {
            type: 'integer',
            description:
                'Across all buckets, so the client needn’t re-add them.'
        }
    }
};

/**
 * Live content with unpublished edits on top.
 *
 * `status` alone cannot separate "never published" from "published, then
 * edited" — `publishedAt` is stamped on the first publish and cleared only by
 * an unpublish, so draft + a timestamp is the admin's **Modified** badge and
 * draft + no timestamp is a draft nobody ever shipped. That is the whole reason
 * this endpoint exists, and why the three totals are not derivable from the
 * pipeline's.
 */
const UNSHIPPED: OpenApiSchema = {
    type: 'object',
    required: ['types', 'modified', 'live', 'neverPublished'],
    properties: {
        types: {
            type: 'array',
            description:
                'One row per publishable type holding at least one modified entry. A type with nothing pending is omitted.',
            items: {
                type: 'object',
                required: ['name', 'label', 'modified', 'published'],
                properties: {
                    name: { type: 'string' },
                    label: { type: 'string' },
                    modified: {
                        type: 'integer',
                        description: 'Live entries with unpublished edits.'
                    },
                    published: {
                        type: 'integer',
                        description: 'Live entries with nothing pending.'
                    }
                }
            }
        },
        modified: {
            type: 'integer',
            description: 'Modified entries across the workspace.'
        },
        live: {
            type: 'integer',
            description:
                'Entries with a live version at all (`modified` + fully published).'
        },
        neverPublished: {
            type: 'integer',
            description: 'Drafts that have never gone live.'
        }
    }
};

/** The schemas this pass adds, keyed by component name. */
export function buildContentInsightsSchemas(): Record<string, OpenApiSchema> {
    return {
        InsightsContentTotals: TOTALS,
        InsightsContentPipeline: PIPELINE,
        InsightsContentVelocity: VELOCITY,
        InsightsContentPunchcard: PUNCHCARD,
        InsightsContentStale: STALE,
        InsightsContentUnshipped: UNSHIPPED
    };
}

/** The routes, keyed by what follows `/insights/content`. */
const ROUTES: Record<string, { schema: string; description: string }> = {
    '/totals': {
        schema: 'InsightsContentTotals',
        description:
            'Headline counts, their deltas over the window, and the sparklines.'
    },
    '/pipeline': {
        schema: 'InsightsContentPipeline',
        description: 'Draft/published split per content type.'
    },
    '/velocity': {
        schema: 'InsightsContentVelocity',
        description: 'Entries published per bucket, oldest first.'
    },
    '/punchcard': {
        schema: 'InsightsContentPunchcard',
        description: 'Editing activity by weekday and hour.'
    },
    '/stale': {
        schema: 'InsightsContentStale',
        description: 'Published entries by how long ago they were last edited.'
    },
    '/unshipped': {
        schema: 'InsightsContentUnshipped',
        description:
            'Live entries with unpublished edits, and what has never shipped.'
    }
};

/**
 * Matches `<prefix>/insights/content<rest>`.
 *
 * The prefix is matched as segments carrying no `{`, so a nested route that
 * merely ends the same way is not described with these shapes.
 */
const ROUTE_RE = /^(?:\/[^/{}]+)*\/insights\/content(\/.*)?$/;

/**
 * Writes the schema onto whichever 2xx key the scanner emitted, never inventing
 * one. These are all `@Get`s, so it is a 200 in practice.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { 'application/json': { schema } }
    };
    operation.responses = responses;
}

/** Adds the content-insights schemas and describes the six widget routes. */
export function describeContentInsightsApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildContentInsightsSchemas());

    for (const [route, item] of Object.entries(document.paths)) {
        const match = ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const spec = ROUTES[match[1] ?? ''];
        if (!spec) {
            continue;
        }
        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            if (
                method !== 'get' ||
                !operation ||
                typeof operation !== 'object'
            ) {
                continue;
            }
            setSuccessResponse(operation, ref(spec.schema), spec.description);
        }
    }
}
