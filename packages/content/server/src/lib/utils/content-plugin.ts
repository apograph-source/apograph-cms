import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { ContentModule } from '../content.module';
import { describeContentApi } from '../docs/describe-content-api';
import { describeContentInsightsApi } from '../insights/docs/describe-content-insights-api';
import { ContentTypeRegistry } from '../registry/content-type-registry';
import type { AnyContentType } from '../types/content-type';

/** Options for {@link ContentPlugin}. */
export interface ContentPluginOptions {
    /** Every code-defined content type (collections and singles). */
    types: readonly AnyContentType[];
    /**
     * The HOST's migrations for the generated collection tables. The host
     * owns this schema (its drizzle.config.ts diffs the re-exported
     * tables), but routing the descriptor through the plugin lets the
     * standard `db:migrate` machinery apply it with everything else.
     */
    migrations?: ServerPlugin['migrations'];
}

/** The content plugin's `ServerPlugin`, exposing its registry. */
export interface ContentServerPlugin extends ServerPlugin {
    registry: ContentTypeRegistry;
}

/**
 * Content plugin factory. Builds the registry eagerly — duplicate names
 * or unresolvable relation targets throw here, failing boot rather than
 * the first request.
 *
 * @example
 *   ContentPlugin({
 *       types: [post, author, home],
 *       migrations: {
 *           dir: () => join(__dirname, '../migrations'),
 *           table: '__drizzle_migrations_content'
 *       }
 *   })
 */
export function ContentPlugin(
    options: ContentPluginOptions
): ContentServerPlugin {
    const registry = new ContentTypeRegistry(options.types);
    return {
        name: 'content',
        module: ContentModule.forRoot(registry),
        registry,
        ...(options.migrations ? { migrations: options.migrations } : {}),
        // The generic `/content/:typeName` controllers are all `@nestjs/swagger`
        // can see; the registry is what knows `article` from `home_page`. This
        // hook is where the code-defined types become OpenAPI schemas.
        docs: {
            decorate: (document) => {
                describeContentApi(document, registry.serializeAll());
                // The Insights widgets are a second surface with a fixed
                // contract — six unlike payloads whose views are `interface`s,
                // so the scanner emits an empty 200 for each. Described from
                // their own module rather than folded into the pass above:
                // they are grouped under the `insights` tag, not `content`.
                describeContentInsightsApi(document);
            }
        }
    };
}
