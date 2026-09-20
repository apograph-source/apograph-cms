import type { Database } from '@orthacms/database';
import type { StorageProvider } from '@orthacms/media-domain';
import { StorageProviderCheck } from './storage-provider.check';

/** A provider that only has to answer `id` and, sometimes, `verify()`. */
function provider(id: string, verify?: () => Promise<void>): StorageProvider {
    return {
        id,
        capabilities: {
            directUrl: false,
            contentTypeMetadata: false,
            streamingPut: true
        },
        ...(verify ? { verify } : {})
    } as unknown as StorageProvider;
}

/**
 * A stand-in for the one query this check runs:
 * `select(...).from(mediaAsset).groupBy(...)`.
 */
function db(
    result: { storageProvider: string; count: number }[] | Error
): Database {
    return {
        select: () => ({
            from: () => ({
                groupBy: () =>
                    result instanceof Error
                        ? Promise.reject(result)
                        : Promise.resolve(result)
            })
        })
    } as unknown as Database;
}

const check = (
    rows: { storageProvider: string; count: number }[] | Error,
    p: StorageProvider
) => new StorageProviderCheck(db(rows), p);

describe('StorageProviderCheck', () => {
    it('passes when the library is empty', async () => {
        await expect(
            check([], provider('local')).onApplicationBootstrap()
        ).resolves.toBeUndefined();
    });

    it('passes when every asset was written by the configured provider', async () => {
        await expect(
            check(
                [{ storageProvider: 'local', count: 4000 }],
                provider('local')
            ).onApplicationBootstrap()
        ).resolves.toBeUndefined();
    });

    it('refuses to boot over assets written by another provider, naming it and the count [media:I-04]', async () => {
        // The whole point: swapping the provider in `plugins.ts` makes those
        // 4000 assets unreadable — their bytes are in a store this process is
        // not connected to. Unchecked, that is a library of broken images and a
        // 500 per request, with nothing in the message naming the cause.
        await expect(
            check(
                [{ storageProvider: 'local', count: 4000 }],
                provider('s3')
            ).onApplicationBootstrap()
        ).rejects.toThrow(/"local" \(4000 assets\).*configured with "s3"/s);
    });

    it('names every foreign provider, not just the first', async () => {
        await expect(
            check(
                [
                    { storageProvider: 'local', count: 3 },
                    { storageProvider: 's3', count: 7 }
                ],
                provider('memory')
            ).onApplicationBootstrap()
        ).rejects.toThrow(/"local" \(3 assets\), "s3" \(7 assets\)/);
    });

    it('runs the provider’s own verify() and fails the boot on it', async () => {
        // A wrong bucket or an expired key should stop the server here, not
        // surface as a failed upload hours later.
        const failing = provider('s3', () =>
            Promise.reject(new Error('NoSuchBucket'))
        );

        await expect(
            check([], failing).onApplicationBootstrap()
        ).rejects.toThrow('NoSuchBucket');
    });

    it('verifies before it queries — a dead backend is the more urgent report', async () => {
        const order: string[] = [];
        const verifying = provider('local', async () => {
            order.push('verify');
        });
        const tracking = {
            select: () => ({
                from: () => ({
                    groupBy: () => {
                        order.push('query');
                        return Promise.resolve([]);
                    }
                })
            })
        } as unknown as Database;

        await new StorageProviderCheck(
            tracking,
            verifying
        ).onApplicationBootstrap();

        expect(order).toEqual(['verify', 'query']);
    });

    it('accepts a provider with no verify() at all', async () => {
        await expect(
            check([], provider('local')).onApplicationBootstrap()
        ).resolves.toBeUndefined();
    });

    it('skips the check when media_asset is not queryable yet [media:I-04]', async () => {
        // Migrations are a separate step (`nx run server:db:migrate`), so a
        // fresh database boots the app before the table exists. Failing there
        // would make this check the reason a clean install cannot start —
        // exactly backwards.
        await expect(
            check(
                new Error('relation "media_asset" does not exist'),
                provider('local')
            ).onApplicationBootstrap()
        ).resolves.toBeUndefined();
    });
});
