import { apiClient, toApiError } from '@orthacms/utils-admin';
import type { Workspace } from '../../domain/types/workspace';
import type {
    ContentType,
    CreateWorkspaceBody,
    DirectoryUser
} from '../../domain/types/wizard';
import { toWorkspace, type WorkspaceView } from '../workspaceMapper';
import type {
    AddWorkspaceContentInput,
    AddWorkspaceMemberInput,
    RemoveWorkspaceContentInput,
    RemoveWorkspaceMemberInput,
    SetWorkspaceStatusInput,
    UpdateWorkspaceInput,
    WorkspaceGateway
} from '../workspaceGateway';

/** Response of `GET /api/workspaces/:id/content/:slug/entry-count`. */
interface ContentCountView {
    /** Entries of the content type currently stored in the workspace. */
    count: number;
}

/** Response of `GET /api/workspaces/:id/entry-count`. */
interface EntryCountView {
    /** Total entries across every content type in the workspace. */
    count: number;
}

/** A page of members from `GET /api/users` — only the fields the typeahead needs. */
interface MembersPage {
    items: {
        id: string;
        name: string | null;
        email: string;
        status: 'pending' | 'active' | 'disabled';
    }[];
}

/** How many matches the typeahead asks for per query. */
const TYPEAHEAD_PAGE_SIZE = 10;

/**
 * HTTP implementation of {@link WorkspaceGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 * Every workspace response is run through the `toWorkspace` anti-corruption
 * mapper, and every failure is normalized with `toApiError`, so callers see the
 * admin's models and `ApiError`, never axios internals.
 */
export const httpWorkspaceGateway: WorkspaceGateway = {
    async list(): Promise<Workspace[]> {
        try {
            const { data } =
                await apiClient.get<WorkspaceView[]>('/workspaces');
            return data.map(toWorkspace);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async create(body: CreateWorkspaceBody): Promise<Workspace> {
        try {
            const { data } = await apiClient.post<WorkspaceView>(
                '/workspaces',
                body
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async update({ id, ...patch }: UpdateWorkspaceInput): Promise<Workspace> {
        try {
            const { data } = await apiClient.patch<WorkspaceView>(
                `/workspaces/${id}`,
                patch
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async setStatus({
        id,
        status
    }: SetWorkspaceStatusInput): Promise<Workspace> {
        const action = status === 'Archived' ? 'archive' : 'unarchive';
        try {
            const { data } = await apiClient.post<WorkspaceView>(
                `/workspaces/${id}/${action}`
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async remove(id: string): Promise<void> {
        try {
            await apiClient.delete(`/workspaces/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async addMember({
        workspaceId,
        userId
    }: AddWorkspaceMemberInput): Promise<Workspace> {
        try {
            const { data } = await apiClient.post<WorkspaceView>(
                `/workspaces/${workspaceId}/members`,
                { userId }
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async removeMember({
        workspaceId,
        userId
    }: RemoveWorkspaceMemberInput): Promise<void> {
        try {
            await apiClient.delete(
                `/workspaces/${workspaceId}/members/${userId}`
            );
        } catch (error) {
            throw toApiError(error);
        }
    },

    async addContent({
        workspaceId,
        slug
    }: AddWorkspaceContentInput): Promise<Workspace> {
        try {
            const { data } = await apiClient.post<WorkspaceView>(
                `/workspaces/${workspaceId}/content`,
                { slug }
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async removeContent({
        workspaceId,
        slug
    }: RemoveWorkspaceContentInput): Promise<Workspace> {
        try {
            const { data } = await apiClient.delete<WorkspaceView>(
                `/workspaces/${workspaceId}/content/${slug}`
            );
            return toWorkspace(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async checkSlugAvailable(slug: string): Promise<boolean> {
        try {
            const { data } = await apiClient.get<{ available: boolean }>(
                '/workspaces/slug-available',
                { params: { slug } }
            );
            return data.available;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async contentEntryCount(
        workspaceId: string,
        slug: string
    ): Promise<number> {
        try {
            const { data } = await apiClient.get<ContentCountView>(
                `/workspaces/${workspaceId}/content/${slug}/entry-count`
            );
            return data.count;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async entryCount(workspaceId: string): Promise<number> {
        try {
            const { data } = await apiClient.get<EntryCountView>(
                `/workspaces/${workspaceId}/entry-count`
            );
            return data.count;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async searchUsers(query: string): Promise<DirectoryUser[]> {
        try {
            const { data } = await apiClient.get<MembersPage>('/users', {
                params: {
                    search: query,
                    pageSize: TYPEAHEAD_PAGE_SIZE
                }
            });
            return data.items
                .filter((member) => member.status !== 'disabled')
                .map((member) => ({
                    id: member.id,
                    name: member.name ?? member.email,
                    email: member.email
                }));
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listContentTypes(): Promise<ContentType[]> {
        try {
            const { data } =
                await apiClient.get<ContentType[]>('/content-types');
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    }
};
