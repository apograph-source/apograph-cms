import {
    apiClient,
    asAvatarColor,
    initialsOf,
    toApiError
} from '@orthacms/utils-admin';
import type {
    ApiTokenList,
    CreatedApiToken
} from '../../domain/types/apiToken';
import type { WorkspaceOption } from '../../domain/types/workspaceOption';
import {
    toApiToken,
    toCreatedApiToken,
    type ApiTokenResponse,
    type CreatedApiTokenResponse
} from '../apiTokenMapper';
import type { ApiTokensListParams } from '../apiTokensKeys';
import type { ApiTokenGateway, CreateApiTokenInput } from '../apiTokenGateway';

/** The paginated envelope returned by `GET /api/api-tokens`. */
type ApiTokenListResponse = {
    items: ApiTokenResponse[];
    total: number;
    page: number;
    pageSize: number;
};

/** Only the fields the selector needs from `GET /api/workspaces`. */
type WorkspaceOptionResponse = {
    id: string;
    name: string;
    description: string | null;
    color: string;
};

/** Maps a workspace row to the selector's option shape. */
function toWorkspaceOption(dto: WorkspaceOptionResponse): WorkspaceOption {
    return {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        initials: initialsOf(dto.name),
        color: asAvatarColor(dto.color)
    };
}

/**
 * HTTP implementation of {@link ApiTokenGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 * Every response is run through a mapper and every failure normalized with
 * `toApiError`, so callers see the admin's models and `ApiError`, never axios
 * internals. The single place `apiClient` is used in this plugin.
 */
export const httpApiTokenGateway: ApiTokenGateway = {
    async list(params: ApiTokensListParams): Promise<ApiTokenList> {
        try {
            const { data } = await apiClient.get<ApiTokenListResponse>(
                '/api-tokens',
                { params }
            );
            return {
                items: data.items.map(toApiToken),
                total: data.total,
                page: data.page,
                pageSize: data.pageSize
            };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async create(input: CreateApiTokenInput): Promise<CreatedApiToken> {
        try {
            const { data } = await apiClient.post<CreatedApiTokenResponse>(
                '/api-tokens',
                input
            );
            return toCreatedApiToken(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async revoke(id: string): Promise<void> {
        try {
            await apiClient.delete(`/api-tokens/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listWorkspaceOptions(): Promise<WorkspaceOption[]> {
        try {
            const { data } =
                await apiClient.get<WorkspaceOptionResponse[]>('/workspaces');
            return data.map(toWorkspaceOption);
        } catch (error) {
            throw toApiError(error);
        }
    }
};
