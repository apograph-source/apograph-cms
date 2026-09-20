import { apiClient, toApiError } from '@orthacms/utils-admin';
import type {
    BulkActionResult,
    BulkPublishPreview,
    BulkPublishResult,
    ContentType,
    ContentTypeDetail,
    ContentTypeSummaryResponse,
    EntryMedia,
    EntryRecord,
    EntryRelations,
    FilterFieldsResponse,
    MediaRef,
    RelationFieldView,
    RevisionDetail,
    RevisionListView,
    WireFilterField
} from '../../domain/types/contentType';
import type { ContentEntriesParams } from '../contentKeys';
import { toContentType } from '../contentMapper';
import type {
    ContentEntriesResult,
    ContentGateway,
    RelationCandidatesPage,
    RelationCandidatesPageParams,
    SaveEntryInput
} from '../contentGateway';

/** Links fetched per relation-field infinite-scroll page. */
export const RELATION_LINKS_PAGE_SIZE = 20;

/**
 * The list endpoint's hard `MAX_PAGE_SIZE` (`@Max(100)`, which **rejects** an
 * over-cap `pageSize` with a 400 rather than clamping). Each candidate page
 * request stays at or under it; the infinite list grows **past** it by fetching
 * further pages (real offset pagination), so a target type with more than a page
 * of entries is fully scrollable — not artificially capped.
 */
export const RELATION_CANDIDATES_MAX_PAGE_SIZE = 100;

/** Rows fetched per candidate page (kept at or under the server's cap). */
export const RELATION_CANDIDATES_PAGE_SIZE = 25;

/**
 * HTTP implementation of {@link ContentGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix; the
 * ambient `X-Workspace-Id` header scopes every entry request). Every failure is
 * normalized with `toApiError`, and type summaries run through the `toContentType`
 * ACL, so callers see the admin's models and `ApiError`, never axios internals.
 * The single place `apiClient` is used in this plugin.
 */
export const httpContentGateway: ContentGateway = {
    async listTypes(): Promise<ContentType[]> {
        try {
            const { data } =
                await apiClient.get<ContentTypeSummaryResponse[]>(
                    '/content-schema'
                );
            return data.map(toContentType);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getSchema(name: string): Promise<ContentTypeDetail> {
        try {
            const { data } = await apiClient.get<ContentTypeDetail>(
                `/content-schema/${name}`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listFilterFields(name: string): Promise<WireFilterField[]> {
        try {
            const { data } = await apiClient.get<FilterFieldsResponse>(
                `/content-schema/${name}/filter-fields`
            );
            return data.fields;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listEntries(
        name: string,
        params: ContentEntriesParams
    ): Promise<ContentEntriesResult> {
        try {
            const { data } = await apiClient.get<ContentEntriesResult>(
                `/content/${name}`,
                {
                    params: {
                        ...(params.search ? { search: params.search } : {}),
                        ...(params.filter ? { filter: params.filter } : {}),
                        ...(params.sort ? { sort: params.sort } : {}),
                        ...(params.deleted ? { deleted: params.deleted } : {}),
                        // Both or neither: the server ignores `relations`
                        // without a field list, and a field list is meaningless
                        // without the opt-in.
                        ...(params.relations && params.relationFields
                            ? {
                                  relations: params.relations,
                                  relationFields: params.relationFields
                              }
                            : {}),
                        ...Object.fromEntries(
                            Object.entries(params.extra ?? {}).filter(
                                ([, value]) =>
                                    value !== undefined && value !== ''
                            )
                        ),
                        page: params.page,
                        pageSize: params.pageSize
                    }
                }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getEntry(name: string, id: string): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.get<EntryRecord>(
                `/content/${name}/${id}`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getEntryRelations(
        name: string,
        id: string
    ): Promise<Record<string, RelationFieldView>> {
        try {
            const { data } = await apiClient.get<EntryRelations>(
                `/content/${name}/${id}/relations`
            );
            return data.relations;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getEntryMedia(
        name: string,
        id: string
    ): Promise<Record<string, MediaRef[]>> {
        try {
            const { data } = await apiClient.get<EntryMedia>(
                `/content/${name}/${id}/media`
            );
            return data.media;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getRelationField(
        name: string,
        id: string,
        field: string,
        page: number
    ): Promise<RelationFieldView> {
        try {
            const { data } = await apiClient.get<RelationFieldView>(
                `/content/${name}/${id}/relations/${field}`,
                { params: { page, pageSize: RELATION_LINKS_PAGE_SIZE } }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listRelationCandidates(
        targetName: string,
        { search, filter, page, extra }: RelationCandidatesPageParams
    ): Promise<RelationCandidatesPage> {
        try {
            const { data } = await apiClient.get<RelationCandidatesPage>(
                `/content/${targetName}`,
                {
                    params: {
                        ...extra,
                        ...(search ? { search } : {}),
                        ...(filter ? { filter } : {}),
                        page,
                        // Never exceed the server's hard cap — an over-cap
                        // pageSize is a 400, not a clamp.
                        pageSize: Math.min(
                            RELATION_CANDIDATES_PAGE_SIZE,
                            RELATION_CANDIDATES_MAX_PAGE_SIZE
                        )
                    }
                }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async saveEntry(
        name: string,
        { id, values, relations, extra, extensions }: SaveEntryInput
    ): Promise<EntryRecord> {
        const body = {
            values,
            ...(relations ? { relations } : {}),
            // Plugin-owned state, on both verbs — an edit changes who may read a
            // record as readily as a create sets it.
            ...(extensions && Object.keys(extensions).length
                ? { extensions }
                : {})
        };
        try {
            // Extra (slot-contributed) keys apply to create only — an update
            // never re-homes envelope params like the locale.
            const { data } = id
                ? await apiClient.patch<EntryRecord>(
                      `/content/${name}/${id}`,
                      body
                  )
                : await apiClient.post<EntryRecord>(`/content/${name}`, {
                      ...body,
                      ...(extra ?? {})
                  });
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listRevisions(name: string, id: string): Promise<RevisionListView> {
        try {
            const { data } = await apiClient.get<RevisionListView>(
                `/content/${name}/${id}/revisions`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getRevision(
        name: string,
        id: string,
        number: number
    ): Promise<RevisionDetail> {
        try {
            const { data } = await apiClient.get<RevisionDetail>(
                `/content/${name}/${id}/revisions/${number}`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async restoreRevision(
        name: string,
        id: string,
        number: number
    ): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.post<EntryRecord>(
                `/content/${name}/${id}/revisions/${number}/restore`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async publishRevision(
        name: string,
        id: string,
        number: number
    ): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.post<EntryRecord>(
                `/content/${name}/${id}/revisions/${number}/publish`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async publish(
        name: string,
        id: string,
        options?: { bypass?: boolean }
    ): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.post<EntryRecord>(
                `/content/${name}/${id}/publish`,
                // No body at all without a bypass, so an ordinary publish is
                // byte-for-byte the request it always was.
                options?.bypass ? { bypass: true } : undefined
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async unpublish(name: string, id: string): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.post<EntryRecord>(
                `/content/${name}/${id}/unpublish`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async remove(name: string, id: string): Promise<void> {
        try {
            await apiClient.delete(`/content/${name}/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async restore(name: string, id: string): Promise<EntryRecord> {
        try {
            const { data } = await apiClient.post<EntryRecord>(
                `/content/${name}/${id}/restore`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async purge(name: string, id: string): Promise<void> {
        try {
            await apiClient.delete(`/content/${name}/${id}/permanent`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    bulkPreviewPublish(
        name: string,
        ids: string[]
    ): Promise<BulkPublishPreview> {
        return bulkPost<BulkPublishPreview>(name, 'publish/preview', ids);
    },
    bulkPublish(name: string, ids: string[]): Promise<BulkPublishResult> {
        return bulkPost<BulkPublishResult>(name, 'publish', ids);
    },
    bulkUnpublish(name: string, ids: string[]): Promise<BulkActionResult> {
        return bulkPost<BulkActionResult>(name, 'unpublish', ids);
    },
    bulkRemove(name: string, ids: string[]): Promise<BulkActionResult> {
        return bulkPost<BulkActionResult>(name, 'delete', ids);
    },
    bulkRestore(name: string, ids: string[]): Promise<BulkActionResult> {
        return bulkPost<BulkActionResult>(name, 'restore', ids);
    },
    bulkPurge(name: string, ids: string[]): Promise<BulkActionResult> {
        return bulkPost<BulkActionResult>(name, 'purge', ids);
    }
};

/** Shared POST helper for the bulk endpoints (`/content/:name/bulk/:suffix`). */
async function bulkPost<T>(
    name: string,
    suffix: string,
    ids: string[]
): Promise<T> {
    try {
        const { data } = await apiClient.post<T>(
            `/content/${name}/bulk/${suffix}`,
            { ids }
        );
        return data;
    } catch (error) {
        throw toApiError(error);
    }
}
