import { apiClient, toApiError } from '@orthacms/utils-admin';
import type { EntryAccess, Segment } from '../domain/types';

/** What the editor page submits to create. */
export type CreateSegmentInput = {
    key: string;
    label: string;
    /** Reader tags; the server defaults to the key. */
    tags?: string[];
    /** Workspaces it is offered in. **Empty means every one.** */
    workspaceIds?: string[];
};

/** A partial segment edit. The key is immutable. */
export type UpdateSegmentInput = {
    id: string;
    label?: string;
    tags?: string[];
    workspaceIds?: string[];
};

/** How the directory is narrowed and paged. */
export type ListSegmentsParams = {
    /** Case-insensitive substring over the label and the key. */
    query?: string;
    /**
     * Only audiences offered in this workspace. The entry editor passes it; the
     * directory does not, because it manages the installation's whole
     * vocabulary.
     */
    workspaceId?: string;
    /** 1-based. */
    page?: number;
    pageSize?: number;
};

/** One page of the directory. */
export type SegmentPage = {
    items: Segment[];
    total: number;
    page: number;
    pageSize: number;
    /**
     * Every id the filter matched, not only this page's — what "set every
     * audience to…" acts on, so a bulk action means the whole list rather than
     * whichever rows are on screen. Capped by the server.
     */
    ids: string[];
    /** Whether {@link SegmentPage.ids} was cut short by that cap. */
    idsTruncated: boolean;
};

/** Replace one entry's lists. Both travel whole — see the port note. */
export type SetEntryAccessInput = {
    entryId: string;
    typeSlug: string;
    allow: string[];
    deny: string[];
};

/**
 * The port over the segments API — the one seam this plugin talks to instead of
 * `apiClient` directly.
 *
 * Two halves with different scopes, deliberately. The segment directory is
 * installation-wide, like a content type. One entry's access is
 * workspace-scoped and reaches the server through `apiClient`'s ambient
 * `X-Workspace-Id` header, which is why those cache keys carry the workspace id
 * explicitly — the header is not sent on a cache hit, so without it one
 * workspace would read another's answer.
 *
 * `setEntryAccess` is a **replace**, matching the `PUT` behind it: the editor
 * submits the whole state of both lists, which is the only shape that can
 * express a removal.
 */
export type SegmentsGateway = {
    /** One page of the directory. */
    listSegments(params?: ListSegmentsParams): Promise<SegmentPage>;
    /**
     * Named segments, whatever page they would fall on — for a caller holding
     * **ids** rather than a page (the entry header chip, a revision's captured
     * access). Unknown ids are skipped, not refused.
     */
    lookupSegments(ids: readonly string[]): Promise<Segment[]>;
    /** One segment — what the editor page loads. */
    getSegment(id: string): Promise<Segment>;
    /** Create a segment. */
    createSegment(input: CreateSegmentInput): Promise<Segment>;
    /** Rename a segment, or change the tags it answers to. */
    updateSegment(input: UpdateSegmentInput): Promise<Segment>;
    /** Delete a segment and drop it from every entry that named it. */
    deleteSegment(id: string): Promise<void>;

    /** One entry's lists. Two empty ones mean everyone. */
    getEntryAccess(entryId: string): Promise<EntryAccess>;
    /** Replace one entry's lists. */
    setEntryAccess(input: SetEntryAccessInput): Promise<EntryAccess>;
};

/** A segment as the wire returns it. */
type SegmentResponse = {
    id: string;
    key: string;
    label: string;
    tags: string[];
    workspaceIds: string[];
    usageCount: number;
};

/** One page of segments as the wire returns it. */
type SegmentPageResponse = {
    items: SegmentResponse[];
    total: number;
    page: number;
    pageSize: number;
    ids: string[];
    idsTruncated: boolean;
};

/** Maps a segment from the wire. Nothing to enrich — the shapes agree. */
function toSegment(dto: SegmentResponse): Segment {
    return {
        id: dto.id,
        key: dto.key,
        label: dto.label,
        tags: dto.tags ?? [],
        workspaceIds: dto.workspaceIds ?? [],
        usageCount: dto.usageCount ?? 0
    };
}

/**
 * HTTP implementation of {@link SegmentsGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 * Every failure is normalised with `toApiError`, so callers see `ApiError`
 * rather than axios internals. The single place `apiClient` is used here.
 */
export const httpSegmentsGateway: SegmentsGateway = {
    async listSegments(params: ListSegmentsParams = {}): Promise<SegmentPage> {
        try {
            const { data } = await apiClient.get<SegmentPageResponse>(
                '/segments',
                {
                    params: {
                        ...(params.query ? { q: params.query } : {}),
                        ...(params.workspaceId
                            ? { workspace: params.workspaceId }
                            : {}),
                        ...(params.page ? { page: params.page } : {}),
                        ...(params.pageSize
                            ? { pageSize: params.pageSize }
                            : {})
                    }
                }
            );
            return {
                items: data.items.map(toSegment),
                total: data.total,
                page: data.page,
                pageSize: data.pageSize,
                ids: data.ids ?? [],
                idsTruncated: data.idsTruncated ?? false
            };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async lookupSegments(ids: readonly string[]): Promise<Segment[]> {
        if (!ids.length) return [];
        try {
            const { data } = await apiClient.get<SegmentResponse[]>(
                '/segments/lookup',
                { params: { ids: [...ids].join(',') } }
            );
            return data.map(toSegment);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getSegment(id: string): Promise<Segment> {
        try {
            const { data } = await apiClient.get<SegmentResponse>(
                `/segments/${id}`
            );
            return toSegment(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async createSegment(input: CreateSegmentInput): Promise<Segment> {
        try {
            const { data } = await apiClient.post<SegmentResponse>(
                '/segments',
                input
            );
            return toSegment(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async updateSegment({ id, ...body }: UpdateSegmentInput): Promise<Segment> {
        try {
            const { data } = await apiClient.patch<SegmentResponse>(
                `/segments/${id}`,
                body
            );
            return toSegment(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async deleteSegment(id: string): Promise<void> {
        try {
            await apiClient.delete(`/segments/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getEntryAccess(entryId: string): Promise<EntryAccess> {
        try {
            const { data } = await apiClient.get<EntryAccess>(
                `/segments/entries/${entryId}`
            );
            return { allow: data.allow ?? [], deny: data.deny ?? [] };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async setEntryAccess({
        entryId,
        ...body
    }: SetEntryAccessInput): Promise<EntryAccess> {
        try {
            const { data } = await apiClient.put<EntryAccess>(
                `/segments/entries/${entryId}`,
                body
            );
            return { allow: data.allow ?? [], deny: data.deny ?? [] };
        } catch (error) {
            throw toApiError(error);
        }
    }
};

/**
 * Query keys.
 *
 * The catalogue and one entry's access are rooted apart: the catalogue is
 * installation-wide and changes when an administrator edits an audience, while
 * an entry's lists change every time an editor touches one. Rooting them
 * together would make a segment rename drop every open entry's answer from
 * cache for no reason a reader could see.
 */
export const segmentsKeys = {
    /** Root covering the installation-wide directory. */
    catalogue: ['segments'] as const,
    /** One page of the directory, for one set of list params. */
    list: (params: ListSegmentsParams = {}) =>
        [
            'segments',
            'list',
            params.query ?? '',
            params.workspaceId ?? '',
            params.page ?? 1,
            params.pageSize ?? 0
        ] as const,
    /**
     * Named segments, resolved by id.
     *
     * Sorted into the key: two components asking for the same ids in a
     * different order are asking the same question, and an unsorted key would
     * fetch it twice.
     */
    lookup: (ids: readonly string[]) =>
        ['segments', 'lookup', [...new Set(ids)].sort().join(',')] as const,
    /** One segment, for the editor page. */
    detail: (id: string) => ['segments', 'detail', id] as const,
    /**
     * One entry's lists. The workspace is in the key because it reaches the
     * server only as an ambient header, which is never sent on a cache hit.
     *
     * `version` is the entry row's own `updatedAt`, and it is what keeps this
     * cache honest without segments having to hear about every way an entry can
     * change. Access is written **by the entry save** now, so it also moves on
     * paths segments has no hook into — restoring a version, above all, which
     * puts back that version's audiences through content's own use-case. Keying
     * on the row's version means any of them produces a new key and a fresh
     * read, instead of a chip that quietly reports the access the entry used to
     * have. Absent while creating, where there is no row to have a version.
     */
    entry: (workspaceId: string, entryId: string, version?: string) =>
        ['segments', 'entry', workspaceId, entryId, version ?? ''] as const,
    /**
     * Every cached entry's lists.
     *
     * A save writes access to the record's whole **locale group**, and a
     * sibling's `updatedAt` does not move when only its access did — so its key
     * is unchanged and its cached answer is now a lie. Switching locale would
     * show the audiences that locale used to have. Invalidating the prefix is
     * what covers the rows this session never named.
     */
    entries: ['segments', 'entry'] as const
};
