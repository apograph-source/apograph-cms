/** Public API of @orthacms/content-graphql. */

export { ContentGraphqlPlugin } from './lib/utils/content-graphql-plugin';
export type {
    ContentGraphqlPluginOptions,
    ContentGraphqlServerPlugin
} from './lib/utils/content-graphql-plugin';

export { ContentGraphqlModule } from './lib/content-graphql.module';
export {
    CONTENT_GRAPHQL_CONFIG,
    InjectGraphqlConfig
} from './lib/content-graphql.tokens';

export {
    DEFAULT_GRAPHQL_LIMITS,
    DEFAULT_SCHEMA_CACHE_TTL_MS,
    resolveConfig
} from './lib/types/config';
export type {
    ContentGraphqlLimits,
    ContentGraphqlPluginConfig,
    ResolvedContentGraphqlConfig
} from './lib/types/config';

// The schema builder, exported so a consumer inside the monorepo can print the
// SDL for a grant set without standing up a server — the shape a codegen step
// or a schema-drift test wants.
export { buildContentSchema } from './lib/schema/build-schema';
export { SchemaCache } from './lib/schema/schema-cache';
