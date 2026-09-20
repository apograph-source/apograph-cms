import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import type { StorageProvider } from '@orthacms/media-domain';
import { MediaModule } from '../media.module';
import { describeMediaApi } from '../docs/describe-media-api';
import { describeMediaInsightsApi } from '../docs/describe-media-insights-api';
import type { MediaPluginConfig } from '../types/media-config';

/** The media plugin shape, with its config attached. */
export type MediaServerPluginDefinition = ServerPlugin & {
    mediaConfig: MediaPluginConfig;
};

/** Options the host passes to {@link MediaServerPlugin}. */
export interface MediaPluginOptions {
    /**
     * The one storage backend this deployment runs, already constructed with
     * its own settings — `createLocalStorageProvider(…)`,
     * `createS3StorageProvider(…)`, or anything else implementing the port.
     *
     * One object, not a list: bytes go to a single place, so there is nothing
     * to choose between and no name to register. Swapping backend is swapping
     * this expression.
     */
    provider: StorageProvider;
    /** Host config — the upload cap. Names no backend. */
    config: MediaPluginConfig;
}

/**
 * Validate the wiring **eagerly**, the way `CopilotPlugin` validates its own
 * provider list: a broken storage seam is a misconfiguration of the composition
 * root, and the composition root is where it should be reported.
 *
 * Measured on the shipped app before this existed: pointing the media config at
 * a backend nobody had wired booted with no warning of any kind, and every
 * upload answered a bare `500 Internal server error` — a message that names
 * neither the provider nor the setting that chose it.
 */
function assertOptions(options: MediaPluginOptions): void {
    const provider = options.provider as StorageProvider | undefined;
    if (!provider) {
        throw new Error(
            'MediaServerPlugin requires a storage provider. Construct one at the composition root, ' +
                'e.g. `provider: createLocalStorageProvider(config.plugins.media.storage)`.'
        );
    }
    if (typeof provider.id !== 'string' || !provider.id.trim()) {
        throw new Error(
            "MediaServerPlugin's storage provider must expose a non-empty `id` — it is recorded on " +
                'every asset row (`media_asset.storage_provider`) and is what the boot check compares ' +
                'existing rows against.'
        );
    }
    if (!provider.capabilities) {
        throw new Error(
            `The storage provider "${provider.id}" declares no \`capabilities\`. Every provider must ` +
                'state what it supports; the core has no way to detect it.'
        );
    }
    if (provider.capabilities.directUrl && !provider.directUrl) {
        throw new Error(
            `The storage provider "${provider.id}" declares \`capabilities.directUrl\` but implements ` +
                'no `directUrl()`. Declare the capability only when the method exists.'
        );
    }
    if (
        options.config.directServe === 'signed-url' &&
        !provider.capabilities.directUrl
    ) {
        throw new Error(
            `MediaServerPlugin's \`directServe: 'signed-url'\` needs a provider that can mint one, and ` +
                `"${provider.id}" declares \`capabilities.directUrl: false\`. Either drop the setting — ` +
                'downloads then stream through the app, which is the default — or run a backend that ' +
                'signs URLs (`@orthacms/media-provider-s3`). Silently proxying instead would leave the ' +
                'operator believing an optimization is on that is not.'
        );
    }
    const ttl = options.config.directServeTtlSeconds;
    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) {
        throw new Error(
            `MediaServerPlugin's directServeTtlSeconds must be a positive number (got ${ttl}) — ` +
                'a non-positive lifetime mints URLs that are already expired.'
        );
    }
    if (
        !Number.isFinite(options.config.maxUploadBytes) ||
        options.config.maxUploadBytes <= 0
    ) {
        throw new Error(
            "MediaServerPlugin's maxUploadBytes must be a positive number (got " +
                `${options.config.maxUploadBytes}) — a non-positive cap rejects every upload.`
        );
    }
}

/**
 * Creates the media plugin. Register it **after** `WorkspacesPlugin` (its routes
 * use `WorkspaceGuard`) and `IdentityPlugin` (its routes use `PermissionsGuard`).
 * The storage backend is constructed at the composition root and passed in here
 * — the plugin never imports a concrete backend.
 *
 * @example
 * ```typescript
 * MediaServerPlugin({
 *   provider: createLocalStorageProvider(config.plugins.media.storage),
 *   config: config.plugins.media
 * });
 * ```
 */
export function MediaServerPlugin(
    options: MediaPluginOptions
): MediaServerPluginDefinition {
    assertOptions(options);
    return {
        name: 'media',
        module: MediaModule.forRoot({
            provider: options.provider,
            maxUploadBytes: options.config.maxUploadBytes,
            ...(options.config.directServe
                ? { directServe: options.config.directServe }
                : {}),
            ...(options.config.directServeTtlSeconds
                ? {
                      directServeTtlSeconds:
                          options.config.directServeTtlSeconds
                  }
                : {})
        }),
        mediaConfig: options.config,
        migrations: {
            // Lazy — only called at migrate time. Source layout: src/lib/utils
            // → ../../../migrations = <pkg>/migrations.
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_media'
        },
        // `AssetView` and friends are `interface`s, and `StoredMediaTrack`
        // lives in `domain/` where the swagger import is forbidden — so the
        // response shapes are written onto the document here rather than
        // through decorators the scanner has nothing to reflect.
        docs: {
            decorate: (document) => {
                describeMediaApi(document);
                // `/insights/media/*` are this plugin's routes too, but they
                // belong to the Insights surface — a different tag and a
                // different audience — so they are described from their own
                // module rather than folded into the media-resource pass.
                describeMediaInsightsApi(document);
            }
        }
    };
}
