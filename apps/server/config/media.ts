/** Media — the storage backend, plus the download and upload ceilings. */
import type { MediaPluginConfig } from '@orthacms/media-server';
import type { LocalStorageConfig } from '@orthacms/media-provider-local';

import { readEnv, readPositiveInt } from '@orthacms/utils-server';

/**
 * Media settings, plus the connection settings for the one storage backend this
 * deployment runs.
 *
 * The backend settings live **here**, not in `MediaPluginConfig`, for the same
 * reason the copilot's provider settings do (ADR-0004 §2): the plugin names no
 * backend. `plugins.ts` already imports the adapter factory, so importing its
 * config type costs no new coupling — and switching storage is that import plus
 * the type named below, with nothing to change inside the media packages.
 */
export interface OrthaMediaConfig extends MediaPluginConfig {
    /**
     * Whatever the constructed provider needs. Typed by the factory
     * `plugins.ts` calls — `LocalStorageConfig` today; swapping to
     * `createS3StorageProvider` swaps this type with it.
     */
    storage: LocalStorageConfig;
}

/** The storage backend `plugins.ts` constructs, plus the upload ceilings. */
export function mediaConfig(): OrthaMediaConfig {
    return {
        // Settings for the storage backend `plugins.ts` constructs. There is no
        // variable naming which backend runs: that is decided by the factory the
        // composition root imports, so a value here can never point at an
        // adapter nobody wired.
        storage: {
            // Blobs live under a git-ignored project dir by default; point
            // MEDIA_LOCAL_ROOT at a persistent volume for real deployments.
            rootDir: readEnv('MEDIA_LOCAL_ROOT') ?? './.storage/media'
        },
        // Off unless asked for, and only meaningful on a backend that can sign
        // a URL — the plugin refuses the combination at boot rather than
        // proxying while the operator believes otherwise. The default
        // local-filesystem provider cannot, so setting this here without
        // switching the provider in `plugins.ts` is a boot error naming both,
        // which is the intended way to find out.
        directServe:
            readEnv('MEDIA_DIRECT_SERVE') === 'signed-url'
                ? 'signed-url'
                : 'off',
        directServeTtlSeconds: readPositiveInt(
            'MEDIA_DIRECT_SERVE_TTL_SECONDS',
            300
        ),
        // Upload cap — 50 MB by default.
        maxUploadBytes: readPositiveInt('MEDIA_MAX_UPLOAD_BYTES', 52_428_800)
    };
}
