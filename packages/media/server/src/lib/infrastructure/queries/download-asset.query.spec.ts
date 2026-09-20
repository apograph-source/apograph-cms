import { Readable } from 'node:stream';
import type { Database } from '@orthacms/database';
import type { StorageProvider } from '@orthacms/media-domain';
import { DownloadAssetQuery, type AssetLocation } from './download-asset.query';

const bytes = () => Readable.from([Buffer.from('the bytes')]);

function provider(id: string): StorageProvider {
    return {
        id,
        capabilities: {
            directUrl: false,
            contentTypeMetadata: false,
            streamingPut: true
        },
        get: () => Promise.resolve(bytes())
    } as unknown as StorageProvider;
}

const location = (storageProvider: string): AssetLocation => ({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    storageProvider,
    storageKey: 'ws/asset/logo.png',
    mimeType: 'image/png',
    name: 'logo.png',
    size: 9
});

/**
 * `open` takes no database — `locate` already did that — so these run against
 * the provider alone.
 */
describe('DownloadAssetQuery.open', () => {
    it('streams from the deployment’s provider', async () => {
        const query = new DownloadAssetQuery({} as Database, provider('local'));

        await expect(query.open(location('local'))).resolves.toBeInstanceOf(
            Readable
        );
    });

    it('refuses a row written by another provider, naming both [media:I-03]', async () => {
        // The row's name is checked, not used to look a backend up: this
        // deployment runs one provider, and a foreign key means nothing to it.
        // Handing it over anyway would serve whatever that key happens to
        // address here.
        const query = new DownloadAssetQuery({} as Database, provider('local'));

        await expect(query.open(location('s3'))).rejects.toThrow(
            /stored by provider "s3".*runs "local"/s
        );
    });
});
