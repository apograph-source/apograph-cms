import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { SegmentsModule } from '../segments.module';
import { describeSegmentsApi } from '../docs/describe-segments-api';
import type { SegmentsPluginConfig } from '../types/segments-config';

/**
 * The segmentation plugin — who may **read** published content.
 *
 * Register it after `ContentPlugin`, whose read-scope port it binds:
 *
 * ```typescript
 * createServer({
 *   plugins: [
 *     ContentPlugin(config.plugins.content),
 *     SegmentsPlugin({ resolver: myResolver }),
 *   ],
 * });
 * ```
 *
 * **Registering it changes nothing on its own.** With no segment created in the
 * admin the catalogue is empty, no predicate is emitted, and every read costs
 * exactly what it did before — which is the state every existing installation
 * is in, and the first property to keep true when changing the read scope.
 */
export function SegmentsPlugin(
    config: SegmentsPluginConfig = {}
): ServerPlugin {
    return {
        name: 'segments',
        module: SegmentsModule.forRoot(config),
        // Its own folder and its own journal table, like every other plugin
        // that owns tables: the host applies each plugin's pending migrations
        // independently, so installing this one later disturbs nothing already
        // applied. The path is a thunk so it resolves at migrate time and works
        // whether the package is consumed from source or installed from npm.
        migrations: {
            dir: () => join(__dirname, '..', '..', '..', 'migrations'),
            table: '__drizzle_migrations_segments'
        },
        // Every route here answers a framework-free `interface`, which the
        // swagger scanner cannot see and ADR-0003 forbids decorating — so the
        // shapes are written onto the finished document instead.
        docs: {
            decorate: (document) => describeSegmentsApi(document)
        }
    };
}
