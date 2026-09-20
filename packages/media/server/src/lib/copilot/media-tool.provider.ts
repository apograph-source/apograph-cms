import {
    BadRequestException,
    Injectable,
    NotFoundException,
    Optional,
    type OnModuleInit
} from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type {
    ToolDefinition,
    ToolProvider,
    ToolSurface
} from '@orthacms/tools-server';
import { AssetId } from '../domain/value-objects/asset-id';
import { toHttp } from '../http/to-http';
import { ListAssetsQuery } from '../infrastructure/queries/list-assets.query';
import { ListFoldersQuery } from '../infrastructure/queries/list-folders.query';
import { DownloadAssetQuery } from '../infrastructure/queries/download-asset.query';
import { mediaKind } from '../infrastructure/schema/media-asset';
import type { AssetView } from '../types/asset-view';
import {
    MAX_READABLE_BYTES,
    isReadableMimeType,
    readAssetText
} from './asset-text';

/**
 * Runs a query and maps any media domain error to its HTTP equivalent.
 *
 * A shared tool must throw an `HttpException` subclass, because the two
 * surfaces flatten a throw differently: the copilot's run engine reports
 * `error.message`, while MCP's `toToolError` treats a non-`HttpException` as a
 * bug and returns an opaque 500 with the message withheld. The tool handlers
 * obeyed that for the throws they make themselves, but the queries they call
 * raise framework-free domain errors one layer down — `InvalidAssetFilterError`
 * for a `folderId` that is not a uuid — and nothing converted them, so a
 * plainly bad argument told an MCP caller the server had broken.
 *
 * `toHttp` is the media plugin's one error mapping, shared with the HTTP
 * controllers so the two adapters cannot drift, and it rethrows anything it
 * does not recognize — a genuine bug is still a 500.
 */
async function mapDomainErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        toHttp(error);
    }
}

/** {@link mapDomainErrors} for a throw that happens before any await. */
function mapDomainErrorsSync<T>(run: () => T): T {
    try {
        return run();
    } catch (error) {
        toHttp(error);
    }
}

/** Assets a single `media_assets_search` call may return. */
const MAX_TOOL_PAGE_SIZE = 25;

/**
 * The media plugin's read contribution to the shared tool catalogue —
 * `media_assets_search`, `media_folders_list` and `media_asset_read`.
 *
 * **All three are offered to both surfaces** (no `surfaces` field), which makes
 * them the first tools in the registry that are genuinely shared rather than
 * split. Nothing here has the tension that keeps the content tools apart: an
 * asset has no draft/published state to leak, these read nothing, and the
 * library is workspace-scoped identically for a token and a signed-in user.
 * Both scopes of API token carry `media:read`, and the MCP endpoint had no
 * media tools at all — a token could upload an asset over `/api/v1/media` and
 * then had no way to find it again.
 *
 * The one thing that does differ is the **link**, and only because the two
 * callers hold different credentials: see `downloadPathFor`.
 *
 * Each is a thin wrapper over the same query the library's own route calls,
 * with departures that answer something a model needs and the admin's browser
 * does not:
 *
 * - **Search spans every folder by default.** The library browses one folder at
 *   a time; a model asked "do we have a logo?" does not know which folder to
 *   look in, and a folder-scoped search would answer "no" for an asset that
 *   exists.
 * - **Search returns a narrowed projection.** A full `AssetView` carries
 *   variant lists and intrinsic dimensions, which cost prompt tokens and answer
 *   nothing.
 * - **Folders come back flat.** `parentId` is enough for a model to rebuild the
 *   tree, and costs fewer tokens than nesting it here would.
 *
 * Every query is workspace-scoped, so an id from another workspace simply does
 * not match — with one explicit exception handled in `readAsset` below.
 */
@Injectable()
export class MediaCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly assets: ListAssetsQuery,
        private readonly folders: ListFoldersQuery,
        private readonly download: DownloadAssetQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the shared tool registry once the DI graph is built.
     * `@Optional()` because a deployment may run neither consumer, in which
     * case these simply go unregistered.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The media read tools. */
    tools(): readonly ToolDefinition[] {
        return [this.searchAssets(), this.listFolders(), this.readAsset()];
    }

    /** `media_assets_search` — one page of the workspace's media library. */
    private searchAssets(): ToolDefinition {
        return {
            name: 'media_assets_search',
            title: 'Search media assets',
            description:
                'Search the workspace’s media library by file name, across every folder. ' +
                'Filter by `kind` to narrow to images, video, audio, documents or archives. ' +
                'Returns each asset’s id, name, kind, MIME type, size, alt text and a ' +
                '`downloadPath` you can offer the user as a link — use the id to reference an ' +
                'asset in an answer or pass it to another tool, and note that an asset with no ' +
                'alt text reports `alt: null`. To search one folder, get its id from ' +
                'media_folders_list first.',
            inputSchema: {
                type: 'object',
                properties: {
                    search: {
                        type: 'string',
                        maxLength: 255,
                        description:
                            'Case-insensitive substring of the file name. Omit to list everything.'
                    },
                    kind: {
                        type: 'string',
                        enum: [...mediaKind.enumValues],
                        description: 'Restrict to one coarse media category.'
                    },
                    folderId: {
                        type: 'string',
                        description:
                            'Restrict to one folder, as returned by media_folders_list. Omit to ' +
                            'search every folder — usually what you want.'
                    },
                    sort: {
                        type: 'string',
                        enum: [
                            'newest',
                            'oldest',
                            'name-asc',
                            'name-desc',
                            'largest',
                            'smallest'
                        ],
                        description: 'Result order. Defaults to newest first.'
                    },
                    page: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based page number.'
                    },
                    pageSize: {
                        type: 'integer',
                        minimum: 1,
                        maximum: MAX_TOOL_PAGE_SIZE,
                        description: `Assets per page (max ${MAX_TOOL_PAGE_SIZE}).`
                    }
                },
                additionalProperties: false
            },
            requires: [PERMISSIONS.MEDIA_READ],
            readOnly: true,
            effect: 'read',
            handler: async (input, ctx) => {
                const args = (input ?? {}) as {
                    search?: string;
                    kind?: string;
                    folderId?: string;
                    sort?: string;
                    page?: number;
                    pageSize?: number;
                };

                // Clamped in `run` as well as declared in the schema: the
                // validator is defence in depth, not the boundary.
                const pageSize = Math.min(
                    Math.max(args.pageSize ?? 10, 1),
                    MAX_TOOL_PAGE_SIZE
                );
                const result = await mapDomainErrors(() =>
                    this.assets.execute({
                        workspaceId: ctx.workspaceId,
                        // Spread rather than pass `folderId: args.folderId`:
                        // the query distinguishes an absent key (every folder)
                        // from an explicit `null` (the root folder), and
                        // passing `undefined` under the key would read as the
                        // root.
                        ...(args.folderId ? { folderId: args.folderId } : {}),
                        ...(args.search ? { search: args.search } : {}),
                        ...(args.kind ? { kind: args.kind } : {}),
                        ...(args.sort ? { sort: args.sort } : {}),
                        page: Math.max(args.page ?? 1, 1),
                        pageSize
                    })
                );

                return {
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    items: result.items.map((asset) =>
                        summarizeAsset(asset, ctx.surface)
                    )
                };
            }
        };
    }

    /**
     * `media_folders_list` — every folder in the workspace, flat.
     *
     * This is what makes `media_assets_search`'s `folderId` usable at all.
     * Nothing else in the catalogue tells a model that folders exist or what
     * their ids are, so before this tool "what's in the Brand folder?" was
     * unanswerable however the search tool was described.
     *
     * No pagination and no arguments: a workspace has tens of folders, not
     * thousands, and the whole list is smaller than the paging metadata that
     * would describe it. If that stops being true, cap it then.
     */
    private listFolders(): ToolDefinition {
        return {
            name: 'media_folders_list',
            title: 'List media folders',
            description:
                'List every folder in the workspace’s media library, each with the number of ' +
                'assets directly inside it. The list is flat — follow `parentId` to rebuild the ' +
                'tree, where `null` means a top-level folder. `rootAssetCount` is how many ' +
                'assets sit outside any folder. Call this first whenever the user names a ' +
                'folder, to turn that name into the id the other media tools take.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            },
            requires: [PERMISSIONS.MEDIA_READ],
            readOnly: true,
            effect: 'read',
            handler: async (_input, ctx) =>
                this.folders.execute(ctx.workspaceId)
        };
    }

    /**
     * `media_asset_read` — the decoded contents of a text asset.
     *
     * The one tool here that reads bytes rather than rows, and the one that
     * widens the prompt-injection surface: until now the copilot read content
     * the team authored, and this reads a file anyone holding `media:create`
     * put in the library. A `.md` file is a perfect vehicle for "ignore your
     * previous instructions".
     *
     * The defence is the one every tool result already gets — the run engine
     * wraps this output in `fenceUntrusted` before the model sees it, which
     * makes the closing delimiter unforgeable from inside the payload
     * (ADR-0005 §8). That makes injection harder, not impossible, and the real
     * ceiling stays the capability profile: a viewer whose copilot reads a
     * hostile file still cannot write anything, because it was never offered a
     * write tool.
     */
    private readAsset(): ToolDefinition {
        return {
            name: 'media_asset_read',
            title: 'Read a text asset',
            description:
                'Read the contents of a text file in the media library — Markdown, CSV, JSON, ' +
                'XML, HTML or plain text. Find the asset with media_assets_search first and ' +
                'pass its id. Binary files (PDF, Word, images, archives) cannot be read and ' +
                'return an error saying so. Files larger than ' +
                `${Math.round(MAX_READABLE_BYTES / 1024)}KB come back cut short with ` +
                '`truncated: true` — say so rather than describing a partial file as if it ' +
                'were whole.',
            inputSchema: {
                type: 'object',
                properties: {
                    assetId: {
                        type: 'string',
                        description:
                            'The asset’s id, as returned by media_assets_search.'
                    }
                },
                required: ['assetId'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.MEDIA_READ],
            readOnly: true,
            effect: 'read',
            handler: async (input, ctx) => {
                const { assetId } = (input ?? {}) as { assetId: string };

                // `locate` filters on a `uuid` column, so a non-uuid id used
                // to reach the driver and come back as an opaque 500 — the
                // same defect `media_assets_search`'s `folderId` had. The
                // registry's JSON Schema subset ignores `format`, so nothing
                // upstream checks the shape; `AssetId.create` does, and
                // `mapDomainErrors` turns its throw into a 400.
                mapDomainErrorsSync(() => AssetId.create(assetId));

                // `locate` is deliberately UNSCOPED — the download route
                // derives the workspace from the row because an `<img>` tag
                // cannot send `X-Workspace-Id`. Nothing upstream has scoped
                // this call, so the check belongs here, and a mismatch reports
                // the same "no such asset" as a missing row: an id from another
                // workspace must not be distinguishable from one that does not
                // exist, or the tool becomes an asset-id oracle.
                const location = await this.download.locate(assetId);
                if (!location || location.workspaceId !== ctx.workspaceId) {
                    // `HttpException` subclasses rather than bare `Error`s
                    // because the two surfaces flatten a throw differently:
                    // the copilot's run engine reports `error.message`, while
                    // MCP's `toToolError` treats a non-`HttpException` as a
                    // bug and returns an opaque 500 with the message
                    // withheld. A shared tool must be legible on both, and a
                    // model that is told "500" instead of "no such asset"
                    // retries the same call.
                    throw new NotFoundException(`No asset "${assetId}".`);
                }

                if (!isReadableMimeType(location.mimeType)) {
                    throw new BadRequestException(
                        `"${location.name}" is ${location.mimeType}, which is not a text format. ` +
                            'Only text files can be read.'
                    );
                }

                const stream = await mapDomainErrors(() =>
                    this.download.open(location)
                );
                const { text, truncated, bytesRead } =
                    await readAssetText(stream);

                return {
                    id: assetId,
                    name: location.name,
                    mimeType: location.mimeType,
                    size: location.size,
                    bytesRead,
                    truncated,
                    text
                };
            }
        };
    }
}

/** The fields of an asset worth spending prompt tokens on. */
function summarizeAsset(asset: AssetView, surface: ToolSurface | undefined) {
    return {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        mimeType: asset.mimeType,
        size: asset.size,
        alt: asset.alt,
        tags: asset.tags,
        folderId: asset.folderId,
        createdAt: asset.createdAt,
        downloadPath: downloadPathFor(asset.id, surface)
    };
}

/**
 * Where this caller can actually fetch the bytes — the one thing in these
 * tools that varies by surface, and only because the two callers authenticate
 * differently.
 *
 * The full `AssetView.url` is dropped either way: it is a route the *model*
 * cannot fetch, so spending tokens on it buys nothing. A path is kept because
 * the model is not the only reader — the person asking "list the files in the
 * library" wants links they can click.
 *
 * - **Copilot** → `/api/media/assets/:id/raw`, the session route. It derives
 *   its scope from workspace membership precisely so a browser can load it
 *   directly, which is what makes handing the path to a signed-in reader safe.
 * - **MCP** → `/api/v1/media/assets/:id/raw`, which is `media:read` gated and
 *   fetchable with the very bearer token that made the call. The session route
 *   would 401 an external agent, so returning it there is worse than returning
 *   nothing: a broken link reads as a broken library.
 *
 * Note this is **presentation, not authority** (see `ToolContext.surface`).
 * Both routes enforce the same workspace scoping and the same `media:read`;
 * neither surface is shown an asset the other could not reach.
 */
function downloadPathFor(
    assetId: string,
    surface: ToolSurface | undefined
): string {
    return surface === 'mcp'
        ? `/api/v1/media/assets/${assetId}/raw`
        : `/api/media/assets/${assetId}/raw`;
}
