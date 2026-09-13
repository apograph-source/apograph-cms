/** Media — the storage backend, plus how downloads and uploads are bounded. */
import type { MediaPluginConfig } from '@apograph/media-server';
// apograph:if media-local
import type { LocalStorageConfig } from '@apograph/media-provider-local';
// apograph:end
// apograph:if media-s3
import type { S3StorageConfig } from '@apograph/media-provider-s3';
// apograph:end
// apograph:if media-azure
import type { AzureStorageConfig } from '@apograph/media-provider-azure';
// apograph:end
// apograph:if media-gcs
import type { GcsStorageConfig } from '@apograph/media-provider-gcs';
// apograph:end
// apograph:if media-vercel-blob
import type { VercelBlobStorageConfig } from '@apograph/media-provider-vercel-blob';
// apograph:end
import { readEnv, readPositiveInt } from '@apograph/utils-server';

import { mediaStorage } from './media-storage';

/**
 * Media settings, plus whatever the storage backend `src/plugins.ts`
 * constructs needs. The two move together: the type below is the one exported
 * by the adapter that file imports.
 */
export interface AppMediaConfig extends MediaPluginConfig {
    // apograph:if media-local
    storage: LocalStorageConfig;
    // apograph:end
    // apograph:if media-s3
    storage: S3StorageConfig;
    // apograph:end
    // apograph:if media-azure
    storage: AzureStorageConfig;
    // apograph:end
    // apograph:if media-gcs
    storage: GcsStorageConfig;
    // apograph:end
    // apograph:if media-vercel-blob
    storage: VercelBlobStorageConfig;
    // apograph:end
}

/** Media — the storage backend, plus how downloads and uploads are bounded. */
export function mediaConfig(): AppMediaConfig {
    return {
        storage: mediaStorage(),
        // Redirect an already-authorized download straight to the storage
        // backend instead of streaming it through the app. Off unless asked
        // for, and only possible on a backend that can sign a URL — the plugin
        // refuses the combination at boot rather than proxying while the
        // operator believes otherwise.
        directServe:
            readEnv('MEDIA_DIRECT_SERVE') === 'signed-url'
                ? 'signed-url'
                : 'off',
        directServeTtlSeconds: readPositiveInt(
            'MEDIA_DIRECT_SERVE_TTL_SECONDS',
            300
        ),
        maxUploadBytes: readPositiveInt(
            'MEDIA_MAX_UPLOAD_BYTES',
            50 * 1024 * 1024
        )
    };
}
