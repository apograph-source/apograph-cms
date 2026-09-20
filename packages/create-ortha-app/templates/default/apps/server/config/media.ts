/** Media — the storage backend, plus how downloads and uploads are bounded. */
import type { MediaPluginConfig } from '@orthacms/media-server';
// ortha:if media-local
import type { LocalStorageConfig } from '@orthacms/media-provider-local';
// ortha:end
// ortha:if media-s3
import type { S3StorageConfig } from '@orthacms/media-provider-s3';
// ortha:end
// ortha:if media-azure
import type { AzureStorageConfig } from '@orthacms/media-provider-azure';
// ortha:end
// ortha:if media-gcs
import type { GcsStorageConfig } from '@orthacms/media-provider-gcs';
// ortha:end
// ortha:if media-vercel-blob
import type { VercelBlobStorageConfig } from '@orthacms/media-provider-vercel-blob';
// ortha:end
import { readEnv, readPositiveInt } from '@orthacms/utils-server';

import { mediaStorage } from './media-storage';

/**
 * Media settings, plus whatever the storage backend `src/plugins.ts`
 * constructs needs. The two move together: the type below is the one exported
 * by the adapter that file imports.
 */
export interface AppMediaConfig extends MediaPluginConfig {
    // ortha:if media-local
    storage: LocalStorageConfig;
    // ortha:end
    // ortha:if media-s3
    storage: S3StorageConfig;
    // ortha:end
    // ortha:if media-azure
    storage: AzureStorageConfig;
    // ortha:end
    // ortha:if media-gcs
    storage: GcsStorageConfig;
    // ortha:end
    // ortha:if media-vercel-blob
    storage: VercelBlobStorageConfig;
    // ortha:end
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
