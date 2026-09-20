import type { StorageProvider } from '@orthacms/media-domain';
import type { AssetLocation } from '../infrastructure/queries/download-asset.query';
import {
    DEFAULT_DIRECT_SERVE_TTL_SECONDS,
    directUrlFor,
    type DirectServeConfig
} from './direct-serve';

const location = (mimeType: string, name = 'file.bin'): AssetLocation => ({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    storageProvider: 's3',
    storageKey: 'ws/asset/file.bin',
    mimeType,
    name,
    size: 9
});

/** A provider that records the options it was asked to sign with. */
function signing(canSign = true) {
    const calls: { key: string; options: Record<string, unknown> }[] = [];
    const provider = {
        id: 's3',
        capabilities: {
            directUrl: canSign,
            contentTypeMetadata: true,
            streamingPut: true
        },
        ...(canSign
            ? {
                  directUrl: (
                      key: string,
                      options: Record<string, unknown>
                  ) => {
                      calls.push({ key, options });
                      return Promise.resolve('https://cdn.test/signed');
                  }
              }
            : {})
    } as unknown as StorageProvider;
    return { provider, calls };
}

const on: DirectServeConfig = {
    mode: 'signed-url',
    ttlSeconds: DEFAULT_DIRECT_SERVE_TTL_SECONDS
};
const off: DirectServeConfig = { mode: 'off', ttlSeconds: 300 };

describe('directUrlFor', () => {
    it('returns nothing when the deployment did not ask for it', async () => {
        // The default. Every byte streams through the app.
        const { provider, calls } = signing();

        await expect(
            directUrlFor(provider, off, location('image/png'))
        ).resolves.toBeNull();
        expect(calls).toEqual([]);
    });

    it('returns nothing when the backend cannot sign', async () => {
        // `MediaServerPlugin` refuses this combination at boot, so reaching
        // here means the provider was swapped underneath us. Proxying is the
        // safe answer, not an exception.
        const { provider } = signing(false);

        await expect(
            directUrlFor(provider, on, location('image/png'))
        ).resolves.toBeNull();
    });

    it('signs an inline-safe type as inline', async () => {
        const { provider, calls } = signing();

        await expect(
            directUrlFor(provider, on, location('image/png', 'logo.png'))
        ).resolves.toBe('https://cdn.test/signed');
        expect(calls[0]?.options).toEqual({
            disposition: 'inline',
            fileName: 'logo.png',
            contentType: 'image/png',
            expiresInSeconds: DEFAULT_DIRECT_SERVE_TTL_SECONDS
        });
    });

    it.each([
        ['text/html', 'report.html'],
        ['image/svg+xml', 'logo.svg'],
        ['application/octet-stream', 'thing.bin']
    ])(
        'signs %s as an attachment — the redirect discards our own headers',
        async (mimeType, name) => {
            // This is the case the whole feature turns on. `mime_type` is the
            // uploader's own claim, and a redirect drops the app's
            // `Content-Disposition`, `nosniff` and CSP — so an uploaded `.html`
            // served inline from the bucket would be stored XSS on that origin.
            // SVG is in the list for the same reason it is excluded from the
            // proxied inline set: it is a scriptable document when navigated to.
            const { provider, calls } = signing();

            await directUrlFor(provider, on, location(mimeType, name));

            expect(calls[0]?.options).toMatchObject({
                disposition: 'attachment',
                contentType: mimeType
            });
        }
    );

    it('passes the configured lifetime through', async () => {
        const { provider, calls } = signing();

        await directUrlFor(
            provider,
            { mode: 'signed-url', ttlSeconds: 42 },
            location('image/png')
        );

        expect(calls[0]?.options).toMatchObject({ expiresInSeconds: 42 });
    });

    it('signs the stored key, not the asset id', async () => {
        const { provider, calls } = signing();

        await directUrlFor(provider, on, location('image/png'));

        expect(calls[0]?.key).toBe('ws/asset/file.bin');
    });
});
