import type { AssetLocation } from '../infrastructure/queries/download-asset.query';
import type { StorageProvider } from '@orthacms/media-domain';
import { isInlineSafe } from './download-headers';

/**
 * How the download routes hand bytes to the browser.
 *
 * - `off` — every download streams through the app. The default, and the only
 *   safe answer for a backend that cannot pin response headers on a URL.
 * - `signed-url` — after authorizing the request, redirect to a short-lived
 *   URL the browser fetches from the backend directly.
 */
export type DirectServeMode = 'off' | 'signed-url';

/** Resolved direct-serve settings, bound at the composition root. */
export interface DirectServeConfig {
    mode: DirectServeMode;
    /** Lifetime of a signed URL, in seconds. */
    ttlSeconds: number;
}

/** DI token the module binds to the resolved {@link DirectServeConfig}. */
export const DIRECT_SERVE = Symbol('DIRECT_SERVE');

/** Default lifetime: long enough for a page of tiles, short enough to leak little. */
export const DEFAULT_DIRECT_SERVE_TTL_SECONDS = 300;

/**
 * The URL to redirect an **already-authorized** download to, or `null` to
 * stream it through the app.
 *
 * Two things make this safe, and both are easy to lose:
 *
 * 1. **It runs after authorization, never instead of it.** The caller has
 *    already resolved the asset and checked membership (or the token's
 *    workspace); this only decides how the bytes travel.
 * 2. **The disposition is decided here, by the same `isInlineSafe` the proxy
 *    path uses, and pinned onto the URL.** A redirect discards the app's own
 *    `Content-Disposition`, `X-Content-Type-Options` and CSP, and
 *    `media_asset.mime_type` is the uploader's unverified claim — so an
 *    uploaded `.html` would render on the storage backend's origin instead of
 *    downloading. A provider that cannot pin them declares
 *    `capabilities.directUrl: false` and is proxied instead; that is the whole
 *    contract behind the capability.
 */
export async function directUrlFor(
    provider: StorageProvider,
    config: DirectServeConfig,
    location: AssetLocation
): Promise<string | null> {
    if (config.mode !== 'signed-url') return null;
    // Belt to the plugin's braces: `MediaServerPlugin` refuses to boot this
    // combination, so reaching here means the provider was swapped underneath
    // us. Proxying is the safe answer, not an exception.
    if (!provider.capabilities.directUrl || !provider.directUrl) return null;

    return provider.directUrl(location.storageKey, {
        disposition: isInlineSafe(location.mimeType) ? 'inline' : 'attachment',
        fileName: location.name,
        contentType: location.mimeType,
        expiresInSeconds: config.ttlSeconds
    });
}
