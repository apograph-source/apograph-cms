/**
 * Runtime configuration for the public GraphQL endpoint. Supplied by the host
 * (`apps/server/ortha.config.ts`, the only reader of `process.env`) and injected
 * — this package never reaches for the environment itself.
 */

/**
 * The cost budget a single operation may spend.
 *
 * REST bounded a request structurally — one route, one page, `MAX_PAGE_SIZE`.
 * GraphQL does not: one document can nest, alias, and fan out until the server
 * gives up. These are the replacement bound, enforced **before** execution
 * starts so a refused query costs a parse and nothing else.
 */
export interface ContentGraphqlLimits {
    /**
     * Deepest selection path allowed, counting from the operation's root
     * selection set. Bounds the level-by-level relation loader, which issues a
     * batch per level.
     */
    maxDepth: number;
    /**
     * Ceiling on the estimated rows an operation can touch — each list field's
     * page size multiplied down its nesting path (see `CostMemo.complexity`).
     * The one limit that catches a shallow-but-enormous query, which a depth
     * cap alone lets straight through.
     */
    maxComplexity: number;
    /**
     * Field selections allowed per operation, counted across the whole
     * document — **every** field, not only the aliased ones. Aliasing one
     * expensive field a hundred times is how a caller multiplies cost without
     * ever nesting, and an alias is indistinguishable from a plain selection
     * here by design.
     *
     * Because it is a total, the ceiling has to clear what a legitimate client
     * asks for: a content type with thirty fields is ordinary, and selecting
     * all of them on a list plus a relation is a perfectly normal document.
     * Introspection meta-fields (`__schema`, `__type`) are excluded — they are
     * answered from the in-memory schema and the standard introspection query
     * alone selects 220 fields.
     */
    maxFields: number;
    /** Longest accepted query document, in characters. Checked before parsing. */
    maxQueryLength: number;
}

/** Options for `ContentGraphqlPlugin`. */
export interface ContentGraphqlPluginConfig {
    /**
     * Cost limits. Each key falls back to its default
     * (`DEFAULT_GRAPHQL_LIMITS`), so a host tunes one without restating the
     * rest.
     *
     * There is deliberately no `enabled` flag: a plugin the host does not put in
     * its plugin list is not registered, and that is the off switch.
     */
    limits?: Partial<ContentGraphqlLimits>;
    /**
     * How long a built schema stays cached, in milliseconds.
     *
     * A schema is derived from a workspace's content grants, so revoking a grant
     * must eventually stop appearing in the SDL. A TTL is the deliberately dumb
     * version of that: the alternative — an invalidation hook on the
     * workspace-grant write path — needs a port from `workspaces-server` and buys
     * seconds of freshness on a set that changes by hand. **It is not a security
     * boundary**: every read is authorized against the live grant set at request
     * time by `resolveGrantedType`, so a stale schema can advertise a type whose
     * grant was just revoked but can never actually read it.
     */
    schemaCacheTtlMs?: number;
}

/** Applied when the host sets no limit of its own. */
export const DEFAULT_GRAPHQL_LIMITS: ContentGraphqlLimits = {
    maxDepth: 8,
    maxComplexity: 1000,
    maxFields: 500,
    maxQueryLength: 16_384
};

/** Default schema-cache TTL — one minute. */
export const DEFAULT_SCHEMA_CACHE_TTL_MS = 60_000;

/** The config with every optional key filled in. */
export interface ResolvedContentGraphqlConfig {
    limits: ContentGraphqlLimits;
    schemaCacheTtlMs: number;
}

/** Fills a host-supplied config with the defaults for anything it omitted. */
export function resolveConfig(
    config: ContentGraphqlPluginConfig = {}
): ResolvedContentGraphqlConfig {
    return {
        limits: { ...DEFAULT_GRAPHQL_LIMITS, ...config.limits },
        schemaCacheTtlMs: config.schemaCacheTtlMs ?? DEFAULT_SCHEMA_CACHE_TTL_MS
    };
}
