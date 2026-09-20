/**
 * The media Insights widgets' pass over the host's OpenAPI document.
 *
 * Three read-only aggregates over one table, and three genuinely different
 * shapes: a per-kind breakdown that carries **both** a count and a byte total,
 * a time series that names its own bucket width, and a flat alt-text tally.
 *
 * A separate module from `describe-media-api.ts`, which describes the media
 * resource itself (`/media/assets`, `/media/folders`, `/v1/media`). These are
 * the Insights surface: the host tags by first route segment, so they are
 * grouped under `insights`, and their audience is the dashboard rather than
 * anything managing files.
 *
 * Pure: it takes the document and mutates only these three operations.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { mediaKind } from '../infrastructure/schema/media-asset';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/**
 * What the workspace's library is made of.
 *
 * Both `count` and `bytes` per kind, because they routinely tell opposite
 * stories — a handful of videos can be most of the bill while images are most
 * of the library — and one of them alone lets a reader draw the wrong
 * conclusion with confidence. The kind vocabulary is read from the column's own
 * pg enum, so the reference cannot drift from what the database accepts.
 */
const STORAGE: OpenApiSchema = {
    type: 'object',
    required: ['kinds', 'totalBytes', 'totalCount'],
    properties: {
        kinds: {
            type: 'array',
            description:
                'One row per kind that has at least one asset, largest by bytes first. A kind the workspace holds none of is absent.',
            items: {
                type: 'object',
                required: ['kind', 'count', 'bytes'],
                properties: {
                    kind: {
                        type: 'string',
                        enum: [...mediaKind.enumValues],
                        description: 'The coarse media category.'
                    },
                    count: { type: 'integer' },
                    bytes: {
                        type: 'integer',
                        description: 'Bytes the assets of this kind occupy.'
                    }
                }
            }
        },
        totalBytes: { type: 'integer' },
        totalCount: { type: 'integer' }
    }
};

/** Assets uploaded per bucket. */
const UPLOADS: OpenApiSchema = {
    type: 'object',
    required: ['points', 'granularity', 'total'],
    properties: {
        points: {
            type: 'array',
            description: 'Oldest bucket first.',
            items: {
                type: 'object',
                required: ['bucket', 'value'],
                properties: {
                    bucket: {
                        type: 'string',
                        description:
                            'Bucket start, `YYYY-MM-DD`. The client formats it.',
                        example: '2026-09-04'
                    },
                    value: { type: 'integer' }
                }
            }
        },
        granularity: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description:
                'Chosen from the window rather than requested, so a long range does not return one point per day for a sparkline.'
        },
        total: {
            type: 'integer',
            description: 'Uploads across the whole window.'
        }
    }
};

/** Alt-text coverage across the workspace's images. */
const ALT_COVERAGE: OpenApiSchema = {
    type: 'object',
    description:
        'Images only — the kinds that cannot carry alt text are not counted as gaps.',
    required: ['images', 'withAlt', 'missing'],
    properties: {
        images: {
            type: 'integer',
            description: 'Every image in the workspace.'
        },
        withAlt: {
            type: 'integer',
            description: 'Images carrying a non-empty `alt`.'
        },
        missing: {
            type: 'integer',
            description: 'Images with none — the number that needs work.'
        }
    }
};

/** The routes, keyed by what follows `/insights/media`. */
const ROUTES: Record<string, { schema: string; description: string }> = {
    '/storage': {
        schema: 'InsightsMediaStorage',
        description: 'Assets and bytes per media kind, plus the totals.'
    },
    '/uploads': {
        schema: 'InsightsMediaUploads',
        description: 'Assets uploaded per bucket over the requested window.'
    },
    '/alt': {
        schema: 'InsightsMediaAltCoverage',
        description: 'Alt-text coverage across the workspace’s images.'
    }
};

/**
 * Matches `<prefix>/insights/media<rest>`.
 *
 * The prefix is matched as segments carrying no `{`, so a nested route that
 * merely ends the same way is not described with these shapes — and it is
 * anchored on `/insights/media` rather than the bare `media` segment, which is
 * the mirror image of the guard in `describe-media-api.ts`.
 */
const ROUTE_RE = /^(?:\/[^/{}]+)*\/insights\/media(\/.*)?$/;

/** Adds the three schemas and describes the three widget routes. */
export function describeMediaInsightsApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, {
        InsightsMediaStorage: STORAGE,
        InsightsMediaUploads: UPLOADS,
        InsightsMediaAltCoverage: ALT_COVERAGE
    });

    for (const [route, item] of Object.entries(document.paths)) {
        const match = ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const spec = ROUTES[match[1] ?? ''];
        if (!spec) {
            continue;
        }
        const operation = (item as Record<string, Operation | undefined>)[
            'get'
        ];
        if (!operation || typeof operation !== 'object') {
            continue;
        }
        // Onto whichever 2xx key the scanner emitted — never a new one.
        const responses = operation.responses ?? {};
        const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
        if (!key || key === '204') {
            continue;
        }
        responses[key] = {
            description: spec.description,
            content: {
                'application/json': {
                    schema: { $ref: `#/components/schemas/${spec.schema}` }
                }
            }
        };
        operation.responses = responses;
    }
}
