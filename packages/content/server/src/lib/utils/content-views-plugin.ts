import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { ContentViewsModule } from '../views/content-views.module';
import { describeViewsApi } from '../docs/describe-views-api';
import type { ContentServerPlugin } from './content-plugin';

/** Options for {@link ContentViewsPlugin}. */
export interface ContentViewsPluginOptions {
    /**
     * The content plugin this rides on — its registry is what turns a view's
     * `content:<typeName>` scope back into a known content type. Taking the
     * whole plugin (rather than a bare registry) makes the dependency visible
     * at the composition root: the entry has to be listed *after* the content
     * one, which is also the migration order its foreign keys need.
     */
    content: ContentServerPlugin;
}

/**
 * Saved list views — the named filter/sort/column slices an editor returns to.
 *
 * A **separate `ServerPlugin` entry from the same package** as `ContentPlugin`,
 * and deliberately so. `ServerPlugin.migrations` is one descriptor, and
 * content's is already carrying the HOST's generated collection tables; a
 * second entry is how this package ships its own fixed tables without touching
 * that contract. The host applies both under their own tracking tables.
 *
 * Order matters at the composition root: `saved_views` has foreign keys into
 * identity's `users` and workspaces' `workspaces`, and nothing declares that
 * dependency — list this after both, and after `ContentPlugin` itself.
 */
export function ContentViewsPlugin(
    options: ContentViewsPluginOptions
): ServerPlugin {
    return {
        name: 'content-views',
        module: ContentViewsModule.forRoot(options.content.registry),
        // src/lib/utils → ../../../migrations = <pkg>/migrations.
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_content_views'
        },
        // `SavedView` is a framework-free `interface` (ADR-0003 forbids
        // decorating it) and its `scope` is `content:<typeName>`, which only
        // the registry knows — so the swagger scanner sees neither the shape
        // nor the values, and this hook is where both become visible.
        docs: {
            decorate: (document) =>
                describeViewsApi(
                    document,
                    options.content.registry.serializeAll()
                )
        }
    };
}
