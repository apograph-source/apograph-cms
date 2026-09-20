import { apiClient, toApiError } from '@orthacms/utils-admin';
import { KIND_FILTER_ALL, ROOT_FOLDER_ID } from '../../constants';
import {
    toMediaAsset,
    toMediaFolder,
    type AssetListResponse,
    type AssetResponse,
    type FoldersResponse
} from '../mediaMapper';
import type {
    CreateFolderInput,
    ListAssetsParams,
    MediaAssetPage,
    MediaFoldersResult,
    MediaGateway,
    MoveAssetsInput,
    RenameInput,
    UpdateAssetInput,
    UploadOptions
} from '../mediaGateway';
import type { MediaAsset } from '../../types/mediaAsset';

/** Translates the admin root sentinel to `undefined` (backend root = no id). */
function folderParam(folderId: string): string | undefined {
    return folderId === ROOT_FOLDER_ID ? undefined : folderId;
}

/**
 * The media {@link MediaGateway} over `apiClient`. The one place the plugin
 * touches HTTP: it maps responses through the ACL, normalizes failures to
 * `ApiError`, and translates the root sentinel to/from the wire's `null`.
 * `apiClient` attaches `X-Workspace-Id` automatically inside the workspace shell.
 */
export const httpMediaGateway: MediaGateway = {
    async listFolders(): Promise<MediaFoldersResult> {
        try {
            const { data } =
                await apiClient.get<FoldersResponse>('/media/folders');
            const folderCounts = new Map<string, number>();
            for (const folder of data.folders) {
                folderCounts.set(folder.id, folder.assetCount);
            }
            folderCounts.set(ROOT_FOLDER_ID, data.rootAssetCount);
            return { folders: data.folders.map(toMediaFolder), folderCounts };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listAssets({
        folderId,
        search,
        kind,
        sort,
        page,
        pageSize
    }: ListAssetsParams): Promise<MediaAssetPage> {
        try {
            const term = search?.trim();
            const { data } = await apiClient.get<AssetListResponse>(
                '/media/assets',
                {
                    // Omitted rather than sent empty: `axios` drops an
                    // `undefined` param, and the server reads a missing `search`
                    // as "no search" while `search=` would be a blank term it
                    // has to decide about. `kind` is omitted on the `all`
                    // sentinel for the same reason — the wire says nothing
                    // rather than saying "every kind".
                    params: {
                        folderId: folderParam(folderId),
                        search: term || undefined,
                        kind: kind === KIND_FILTER_ALL ? undefined : kind,
                        sort,
                        page,
                        pageSize
                    }
                }
            );
            return {
                items: data.items.map(toMediaAsset),
                total: data.total,
                page: data.page,
                pageSize: data.pageSize
            };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async createFolder({ name, parentId }: CreateFolderInput): Promise<void> {
        try {
            await apiClient.post('/media/folders', {
                name,
                parentId: folderParam(parentId)
            });
        } catch (error) {
            throw toApiError(error);
        }
    },

    async renameFolder({ id, name }: RenameInput): Promise<void> {
        try {
            await apiClient.patch(`/media/folders/${id}`, { name });
        } catch (error) {
            throw toApiError(error);
        }
    },

    async deleteFolder(id: string): Promise<void> {
        try {
            await apiClient.delete(`/media/folders/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async uploadFile(
        folderId: string,
        file: File,
        options?: UploadOptions
    ): Promise<MediaAsset> {
        const target = folderParam(folderId);
        const form = new FormData();
        form.append('file', file);
        if (target) form.append('folderId', target);
        // Only sent when the author wrote one — an empty part would be a blank
        // description, which the server normalizes away but which would still
        // read as "described" to anyone auditing the request.
        if (options?.alt && options.alt.trim() !== '') {
            form.append('alt', options.alt);
        }
        try {
            const { data } = await apiClient.post<AssetResponse>(
                '/media/assets',
                form,
                {
                    signal: options?.signal,
                    onUploadProgress: (event) => {
                        // `total` is absent on some proxies/streams; without it a
                        // percentage would be a lie, so report nothing and let the
                        // caller keep showing indeterminate progress.
                        if (!event.total) return;
                        options?.onProgress?.(
                            Math.round((event.loaded / event.total) * 100)
                        );
                    }
                }
            );
            return toMediaAsset(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async renameAsset({ id, name }: RenameInput): Promise<void> {
        try {
            await apiClient.patch(`/media/assets/${id}`, { name });
        } catch (error) {
            throw toApiError(error);
        }
    },

    async updateAsset({ id, alt }: UpdateAssetInput): Promise<void> {
        try {
            await apiClient.patch(`/media/assets/${id}`, { alt });
        } catch (error) {
            throw toApiError(error);
        }
    },

    async moveAssets({ ids, folderId }: MoveAssetsInput): Promise<void> {
        const target = folderId === ROOT_FOLDER_ID ? null : folderId;
        try {
            await Promise.all(
                ids.map((id) =>
                    apiClient.patch(`/media/assets/${id}`, { folderId: target })
                )
            );
        } catch (error) {
            throw toApiError(error);
        }
    },

    async duplicateAssets(ids: string[]): Promise<void> {
        try {
            await Promise.all(
                ids.map((id) => apiClient.post(`/media/assets/${id}/duplicate`))
            );
        } catch (error) {
            throw toApiError(error);
        }
    },

    async deleteAssets(ids: string[]): Promise<void> {
        try {
            await apiClient.delete('/media/assets', { data: { ids } });
        } catch (error) {
            throw toApiError(error);
        }
    }
};
