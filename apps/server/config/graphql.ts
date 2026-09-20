/** The public GraphQL endpoint's cost budget. */
import type { ContentGraphqlPluginConfig } from '@orthacms/content-graphql';

import { readPositiveInt } from '@orthacms/utils-server';

/** The public GraphQL endpoint's cost budget. */
export function contentGraphqlConfig(): ContentGraphqlPluginConfig {
    return {
        // The cost budget one GraphQL operation may spend. REST bounded a
        // request structurally — one route, one page — and a GraphQL document
        // does not, so these are the replacement bound. Stable tuning, hence
        // literals, with env overrides for an operator who needs to loosen or
        // tighten them without a redeploy.
        limits: {
            maxDepth: readPositiveInt('GRAPHQL_MAX_DEPTH', 8),
            maxComplexity: readPositiveInt('GRAPHQL_MAX_COMPLEXITY', 1000),
            maxFields: readPositiveInt('GRAPHQL_MAX_FIELDS', 500),
            maxQueryLength: readPositiveInt('GRAPHQL_MAX_QUERY_LENGTH', 16_384)
        },
        // How long a built schema is reused before it is derived again from the
        // workspace's content grants. Freshness only — every read is authorized
        // against the live grants regardless.
        schemaCacheTtlMs: readPositiveInt('GRAPHQL_SCHEMA_CACHE_TTL_MS', 60_000)
    };
}
