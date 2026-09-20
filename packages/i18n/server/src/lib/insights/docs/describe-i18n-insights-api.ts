/**
 * The localization-coverage widget's pass over the host's OpenAPI document.
 *
 * One route, one shape — and the shape needs saying, because its unit is not
 * the obvious one. Every figure here counts **translation groups**, not rows:
 * a localized entry is one row per language sharing a `locale_group_id`, so
 * counting rows would report a workspace of 40 stories in 3 languages as 120
 * things and make every percentage meaningless.
 *
 * Pure: it takes the document and mutates only this plugin's own operation.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/**
 * The four per-type figures, reused for the workspace envelope.
 *
 * `notLocalized` is a **subset** of `requiresLocalization`, not a second slice
 * of it — a record in one language of four both has no translations and needs
 * some. They are separate because they are separate jobs: starting a
 * translation, and finishing one. A client that adds them double-counts.
 */
function coverageCounts(): Record<string, OpenApiSchema> {
    return {
        records: {
            type: 'integer',
            description: 'Translation groups of this type.'
        },
        localized: {
            type: 'integer',
            description:
                'Of those, the ones present in **every** configured locale.'
        },
        notLocalized: {
            type: 'integer',
            description:
                'Of those, the ones present in exactly one locale. Always 0 in a single-locale deployment, where a record would otherwise be both fully localized and not localized at all.'
        },
        requiresLocalization: {
            type: 'integer',
            description:
                'Of those, the ones missing at least one locale (`records - localized`). Includes every `notLocalized` one.'
        }
    };
}

/** The coverage response. */
const COVERAGE: OpenApiSchema = {
    type: 'object',
    description:
        'Localization coverage across every `i18n: true` content type. The unit is a translation group, never a row.',
    required: [
        'locales',
        'records',
        'localized',
        'notLocalized',
        'requiresLocalization',
        'types'
    ],
    properties: {
        locales: {
            type: 'array',
            description: 'One entry per configured locale, in config order.',
            items: {
                type: 'object',
                required: [
                    'locale',
                    'name',
                    'isDefault',
                    'translated',
                    'missing'
                ],
                properties: {
                    locale: {
                        type: 'string',
                        description: 'The configured locale slug.',
                        example: 'de'
                    },
                    name: {
                        type: 'string',
                        description: 'Its display name, from the host’s config.'
                    },
                    isDefault: { type: 'boolean' },
                    translated: {
                        type: 'integer',
                        description: 'Records that have a row in this locale.'
                    },
                    missing: {
                        type: 'integer',
                        description: 'Records that do not.'
                    }
                }
            }
        },
        ...coverageCounts(),
        types: {
            type: 'array',
            description:
                'Per-type coverage, most records first. A type the workspace has never used is omitted rather than listed at zero — a permanently empty row would push the types that hold work further down.',
            items: {
                type: 'object',
                required: [
                    'name',
                    'label',
                    'records',
                    'localized',
                    'notLocalized',
                    'requiresLocalization'
                ],
                properties: {
                    name: { type: 'string' },
                    label: { type: 'string' },
                    ...coverageCounts()
                }
            }
        }
    }
};

/**
 * Matches `<prefix>/insights/i18n/coverage`.
 *
 * The prefix is matched as segments carrying no `{`, so a nested route ending
 * in the same segments is not described with this shape.
 */
const ROUTE_RE = /^(?:\/[^/{}]+)*\/insights\/i18n\/coverage$/;

/** Adds the coverage schema and describes the one operation that returns it. */
export function describeI18nInsightsApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    document.components.schemas['InsightsI18nCoverage'] = COVERAGE;

    for (const [route, item] of Object.entries(document.paths)) {
        if (!ROUTE_RE.test(route)) {
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
            description:
                'Coverage per locale and per localized content type, counted in translation groups.',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/InsightsI18nCoverage'
                    }
                }
            }
        };
        operation.responses = responses;
    }
}
