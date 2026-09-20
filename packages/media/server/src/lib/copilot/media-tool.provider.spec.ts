import { BadRequestException, HttpException } from '@nestjs/common';
import type { ToolContext, ToolDefinition } from '@ortha/tools-server';
import { InvalidAssetFilterError } from '../domain/errors';
import type { DownloadAssetQuery } from '../infrastructure/queries/download-asset.query';
import type { ListAssetsQuery } from '../infrastructure/queries/list-assets.query';
import type { ListFoldersQuery } from '../infrastructure/queries/list-folders.query';
import { MediaCopilotToolProvider } from './media-tool.provider';

/**
 * The three media tools omit `surfaces`, so they are offered to **both** the
 * copilot and MCP — and the two flatten a throw differently. The run engine
 * reports `error.message`, while MCP's `toToolError` treats anything that is
 * not an `HttpException` as a bug and answers an opaque 500 with the message
 * withheld. So a bad argument that leaves this provider as a bare `Error` is
 * legible on one surface and a dead end on the other.
 *
 * These assert the boundary itself: what the handlers throw, not what a
 * transport makes of it.
 */
describe('MediaCopilotToolProvider error mapping', () => {
    const ctx: ToolContext = {
        actor: {
            kind: 'token',
            id: 'token-1',
            displayName: 'test',
            grantedPermissions: new Set<string>(),
            userId: null
        },
        workspaceId: 'ws-1',
        surface: 'mcp',
        // Matches the empty grant set above: these assert what a handler
        // throws, so nothing here should widen on a permission.
        can: () => false
    };

    const build = (
        overrides: {
            assets?: Partial<ListAssetsQuery>;
            download?: Partial<DownloadAssetQuery>;
        } = {}
    ) => {
        const assets = {
            execute: jest.fn().mockResolvedValue({
                total: 0,
                page: 1,
                pageSize: 10,
                items: []
            }),
            ...overrides.assets
        } as unknown as ListAssetsQuery;
        const folders = {
            execute: jest.fn().mockResolvedValue([])
        } as unknown as ListFoldersQuery;
        const download = {
            locate: jest.fn().mockResolvedValue(null),
            open: jest.fn(),
            ...overrides.download
        } as unknown as DownloadAssetQuery;

        const provider = new MediaCopilotToolProvider(
            assets,
            folders,
            download
        );
        const byName = (name: string): ToolDefinition => {
            const tool = provider.tools().find((one) => one.name === name);
            if (!tool) throw new Error(`no tool named ${name}`);
            return tool;
        };
        return { assets, download, byName };
    };

    describe('media_assets_search', () => {
        it('maps a rejected filter to a 400 rather than letting it escape raw', async () => {
            // `assertValidFilters` lives inside `ListAssetsQuery` and raises a
            // framework-free domain error — one layer below the `throw new
            // BadRequestException` the provider already does for itself, which
            // is why reading only this file made the class look covered.
            const { byName } = build({
                assets: {
                    execute: jest
                        .fn()
                        .mockRejectedValue(
                            new InvalidAssetFilterError(
                                'folderId',
                                'folderId must be a UUID'
                            )
                        )
                } as Partial<ListAssetsQuery>
            });

            const thrown = await byName('media_assets_search')
                .handler({ folderId: 'not-a-uuid' }, ctx)
                .catch((error: unknown) => error);

            expect(thrown).toBeInstanceOf(BadRequestException);
            // The reason survives the mapping: an opaque 400 is no more use to
            // a model than the opaque 500 was.
            expect((thrown as BadRequestException).message).toBe(
                'folderId must be a UUID'
            );
        });

        it('still lets a genuine fault through as itself', async () => {
            // `toHttp` rethrows what it does not recognize, so a real bug stays
            // a 500 with its message withheld instead of being dressed up as a
            // caller error the model will retry forever.
            const boom = new Error('connection terminated unexpectedly');
            const { byName } = build({
                assets: {
                    execute: jest.fn().mockRejectedValue(boom)
                } as Partial<ListAssetsQuery>
            });

            await expect(
                byName('media_assets_search').handler({}, ctx)
            ).rejects.toBe(boom);
        });

        it('answers an ordinary search untouched', async () => {
            const { byName } = build();

            await expect(
                byName('media_assets_search').handler({ pageSize: 5 }, ctx)
            ).resolves.toMatchObject({ total: 0, items: [] });
        });
    });

    describe('media_asset_read', () => {
        it('refuses a non-uuid assetId before it reaches the driver', async () => {
            // `locate` filters on a `uuid` column, so a non-uuid used to come
            // back as a driver-level `invalid input syntax for type uuid` — a
            // 500 for what is plainly a bad argument. The registry's JSON
            // Schema subset ignores `format`, so nothing upstream checks it.
            const { byName, download } = build();

            await expect(
                byName('media_asset_read').handler(
                    { assetId: 'not-a-uuid' },
                    ctx
                )
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(download.locate).not.toHaveBeenCalled();
        });

        it('reports an unknown but well-formed id as not found', async () => {
            const { byName } = build();

            const thrown = await byName('media_asset_read')
                .handler(
                    { assetId: '11111111-1111-4111-8111-111111111111' },
                    ctx
                )
                .catch((error: unknown) => error);

            expect(thrown).toBeInstanceOf(HttpException);
            expect((thrown as HttpException).getStatus()).toBe(404);
        });
    });
});

/**
 * What the surface is allowed to change about an answer — and what it is not.
 *
 * These three tools carry no `surfaces` field, so one implementation serves a
 * signed-in browser and a bearer token alike. The rule (`tools:I-09`) is that
 * `ToolContext.surface` may vary the *presentation* of a response and never the
 * checks, the filtering, or the fields disclosed; this provider is the only one
 * in the workspace that reads the field at all, which
 * `packages/tools/server/src/surface-is-presentation.spec.ts` asserts
 * separately.
 *
 * So the pair below is the whole rule for the one place it applies: the same
 * query, run twice, differing in exactly one string.
 */
describe('MediaCopilotToolProvider — surface changes the link, not the answer', () => {
    /** An asset with every field `summarizeAsset` projects, all distinguishable. */
    const asset = {
        id: 'asset-1',
        name: 'logo.svg',
        kind: 'image',
        mimeType: 'image/svg+xml',
        size: 4096,
        alt: 'The logo',
        tags: ['brand'],
        folderId: 'folder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        // Fields the projection deliberately drops. They are here so "the same
        // fields on both surfaces" cannot be satisfied by handing the whole
        // asset back on one of them.
        url: 'https://cdn.example.com/logo.svg',
        variants: [{ name: 'thumb', width: 64 }],
        width: 512,
        height: 512
    };

    /** The caller, save for the surface each case varies. */
    const caller = {
        actor: {
            kind: 'token' as const,
            id: 'token-1',
            displayName: 'test',
            grantedPermissions: new Set<string>(),
            userId: null
        },
        workspaceId: 'ws-1',
        can: () => true
    };

    /** One `media_assets_search` page, as the given surface sees it. */
    async function searchAs(surface: 'mcp' | 'copilot') {
        const assets = {
            execute: jest.fn().mockResolvedValue({
                total: 1,
                page: 1,
                pageSize: 10,
                items: [asset]
            })
        } as unknown as ListAssetsQuery;
        const provider = new MediaCopilotToolProvider(
            assets,
            {
                execute: jest.fn().mockResolvedValue([])
            } as unknown as ListFoldersQuery,
            {
                locate: jest.fn(),
                open: jest.fn()
            } as unknown as DownloadAssetQuery
        );
        const tool = provider
            .tools()
            .find(
                (one) => one.name === 'media_assets_search'
            ) as ToolDefinition;

        const result = (await tool.handler({}, { ...caller, surface })) as {
            total: number;
            items: Record<string, unknown>[];
        };
        return { result, assets };
    }

    it('asks the library the identical question on either surface [tools:I-09]', async () => {
        // "Never a filter": the arguments reaching `ListAssetsQuery` — which is
        // where the workspace scope and every narrowing live — must not depend
        // on who is asking.
        const viaMcp = await searchAs('mcp');
        const viaCopilot = await searchAs('copilot');

        expect((viaMcp.assets.execute as jest.Mock).mock.calls).toEqual(
            (viaCopilot.assets.execute as jest.Mock).mock.calls
        );
    });

    it('discloses the identical fields on either surface [tools:I-09]', async () => {
        // "Never which fields are disclosed". Key sets rather than a subset
        // check: a surface handed one extra field would pass a `toContain`.
        const { result: mcp } = await searchAs('mcp');
        const { result: copilot } = await searchAs('copilot');

        expect(Object.keys(mcp.items[0]).sort()).toEqual(
            Object.keys(copilot.items[0]).sort()
        );
        expect(mcp.total).toBe(copilot.total);
        expect(mcp.items).toHaveLength(1);
    });

    it('differs in the download path and nothing else [tools:I-09]', async () => {
        // The one legitimate difference, stated as an exact diff: strip
        // `downloadPath` and the two answers are the same object. A surface
        // that also withheld `alt`, or added a field, fails here even though
        // the key-set case above would have caught only one of those.
        const { result: mcp } = await searchAs('mcp');
        const { result: copilot } = await searchAs('copilot');
        const without = (item: Record<string, unknown>) => {
            const { downloadPath, ...rest } = item;
            void downloadPath;
            return rest;
        };

        expect(without(mcp.items[0])).toEqual(without(copilot.items[0]));
        expect(mcp.items[0]['downloadPath']).toBe(
            '/api/v1/media/assets/asset-1/raw'
        );
        expect(copilot.items[0]['downloadPath']).toBe(
            '/api/media/assets/asset-1/raw'
        );
    });
});
