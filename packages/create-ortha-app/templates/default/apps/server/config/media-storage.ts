/**
 * Where uploads are written.
 *
 * One block per adapter, and the wizard picks exactly one — so a generated app
 * has the body it chose and nothing else. Swapping backends later means
 * swapping this file, the type on `AppMediaConfig.storage`, and the factory
 * `src/plugins.ts` imports; nothing inside the media package changes.
 */
// ortha:if media-local
import type { LocalStorageConfig } from '@orthacms/media-provider-local';
import { readEnv } from '@orthacms/utils-server';

/** Local-filesystem blobs. */
export function mediaStorage(): LocalStorageConfig {
    return {
        // Point MEDIA_LOCAL_ROOT at a persistent volume in production: a
        // container's own disk is wiped on every deploy.
        rootDir: readEnv('MEDIA_LOCAL_ROOT') ?? './.storage/media'
    };
}
// ortha:end
// ortha:if media-vercel-blob
import type { VercelBlobStorageConfig } from '@orthacms/media-provider-vercel-blob';
import { defined, readEnv } from '@orthacms/utils-server';
/** Vercel Blob. */
export function mediaStorage(): VercelBlobStorageConfig {
    return defined({
        // On Vercel the SDK reads BLOB_READ_WRITE_TOKEN itself, so this is only
        // for running the app elsewhere.
        token: readEnv('BLOB_READ_WRITE_TOKEN')
    });
}
// ortha:end
// ortha:if media-gcs
import type { GcsStorageConfig } from '@orthacms/media-provider-gcs';
import { defined, readEnv, readFlag, requireEnv } from '@orthacms/utils-server';
/** Google Cloud Storage. */
export function mediaStorage(): GcsStorageConfig {
    return defined({
        bucket: requireEnv('MEDIA_GCS_BUCKET'),
        // Everything else is optional: with no key file and no inline
        // credentials the client uses Application Default Credentials, which is
        // what a GKE or Cloud Run deployment wants.
        projectId: readEnv('MEDIA_GCS_PROJECT_ID'),
        keyFilename: readEnv('MEDIA_GCS_KEY_FILE'),
        signWithIam: readFlag('MEDIA_GCS_SIGN_WITH_IAM', false)
    });
}
// ortha:end
// ortha:if media-azure
import type { AzureStorageConfig } from '@orthacms/media-provider-azure';
import { requireEnv } from '@orthacms/utils-server';
/** Azure Blob Storage. */
export function mediaStorage(): AzureStorageConfig {
    return {
        container: requireEnv('MEDIA_AZURE_CONTAINER'),
        connectionString: requireEnv('MEDIA_AZURE_CONNECTION_STRING')
    };
}
// ortha:end
// ortha:if media-s3
import type { S3StorageConfig } from '@orthacms/media-provider-s3';
import { defined, readEnv, readFlag, requireEnv } from '@orthacms/utils-server';
/** S3 or an S3-compatible endpoint — R2, MinIO, Spaces, B2. */
export function mediaStorage(): S3StorageConfig {
    const accessKeyId = readEnv('MEDIA_S3_ACCESS_KEY_ID');
    const secretAccessKey = readEnv('MEDIA_S3_SECRET_ACCESS_KEY');
    return defined({
        bucket: requireEnv('MEDIA_S3_BUCKET'),
        // `auto` is what R2 expects; AWS needs its real region.
        region: readEnv('MEDIA_S3_REGION') ?? 'auto',
        // Omit for AWS S3 itself; set it for R2, MinIO, Spaces, B2…
        endpoint: readEnv('MEDIA_S3_ENDPOINT'),
        forcePathStyle: readFlag('MEDIA_S3_FORCE_PATH_STYLE', false),
        // Absent means "use the SDK's own provider chain" — an instance role,
        // IRSA, a shared config file. Passing blanks instead would shadow all
        // of that with credentials that cannot sign.
        credentials:
            accessKeyId && secretAccessKey
                ? { accessKeyId, secretAccessKey }
                : undefined
    });
}
// ortha:end
