import type { ServerPlugin } from '@orthacms/bootstrap-server';
import type { ContentServerPlugin } from '@orthacms/content-server';
import { ContentGraphqlModule } from '../content-graphql.module';
import { describeGraphqlApi } from '../docs/describe-graphql-api';
import { assertNoEnvelopeCollisions } from '../schema/build-schema';
import { assertNoNameCollisions } from '../schema/naming';
import {
    resolveConfig,
    type ContentGraphqlPluginConfig,
    type ResolvedContentGraphqlConfig
} from '../types/config';

/** Options for {@link ContentGraphqlPlugin}. */
export interface ContentGraphqlPluginOptions
    extends ContentGraphqlPluginConfig {
    /**
     * The content plugin this one serves.
     *
     * Taken as a value rather than resolved through DI so the **name check
     * below runs at composition time**: two content types that would collide in
     * a GraphQL schema should fail the host's boot, not the first request from
     * the one workspace granted both.
     */
    content: ContentServerPlugin;
    /**
     * Serve the GraphiQL playground at `GET /v1/graphql/playground`.
     *
     * A **composition-time** option rather than a config key, because it is the
     * host that knows whether this deployment exposes developer tooling — the
     * same judgement that drives the Scalar reference. `apps/server` passes
     * `docs.enabled`, so one switch governs both API explorers and neither is
     * on in production unless asked for.
     *
     * Defaults to `false`: the page is unauthenticated and invites a pasted
     * bearer token, so it is opt-in rather than opt-out.
     */
    playground?: boolean;
}

/** The GraphQL plugin's `ServerPlugin`, with its resolved config attached. */
export interface ContentGraphqlServerPlugin extends ServerPlugin {
    graphqlConfig: ResolvedContentGraphqlConfig;
}

/**
 * The public content API over GraphQL — a second protocol in front of the
 * surface `@orthacms/content-server` already serves over REST, with the same
 * bearer tokens, the same workspace bucket, the same scopes, and the same
 * visibility rules.
 *
 * Register it **after** `ContentPlugin` (whose global module exports everything
 * this serves with) and after `IdentityPlugin` (whose `AccessPolicy` decides
 * what a token's scope allows). It owns no schema and ships no migrations —
 * adding it changes nothing about the data, and a token minted before it existed
 * works against it unchanged.
 *
 * Leaving it out of the host's plugin list is the off switch; there is no
 * `enabled` flag, because a plugin that is not registered is not there.
 *
 * @example
 *   ContentGraphqlPlugin({
 *       content: contentPlugin,
 *       limits: { maxDepth: 6 }
 *   })
 */
export function ContentGraphqlPlugin(
    options: ContentGraphqlPluginOptions
): ContentGraphqlServerPlugin {
    const { content, playground = false, ...config } = options;
    // Checked against the WHOLE registry, not per workspace: a collision between
    // two content types is a modelling bug, and finding it only when some
    // workspace happens to be granted both would turn it into a production
    // surprise instead of a failed boot.
    const types = content.registry.all();
    assertNoNameCollisions(types.map((type) => type.name));
    // Same argument one level down: a content field named `status` or
    // `translations` collides with the entry envelope, and the schema builder
    // that discovers it runs lazily, per grant set — so without this the boot
    // succeeds and the first request from a workspace granted that type throws.
    assertNoEnvelopeCollisions(types);
    const resolved = resolveConfig(config);
    return {
        name: 'content-graphql',
        module: ContentGraphqlModule.forRoot(resolved, { playground }),
        graphqlConfig: resolved,
        // One route serving a schema that varies per workspace grant set is
        // exactly the contract `@nestjs/swagger` cannot reflect. What the pass
        // describes is the envelope around the answer, not the answer.
        docs: { decorate: describeGraphqlApi }
    };
}
