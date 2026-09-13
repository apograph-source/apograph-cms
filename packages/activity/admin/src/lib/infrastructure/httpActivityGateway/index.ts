import { apiClient, toApiError } from '@apograph/utils-admin';
import type { ActivityList } from '../../types/activityEvent';
import { toActivityEvent, type ActivityEventResponse } from '../activityMapper';
import type { ActivityListParams } from '../activityKeys';
import type { ActivityGateway } from '../activityGateway';

/** The paginated envelope returned by `GET /api/activity`. */
type ActivityListResponse = {
    items: ActivityEventResponse[];
    total: number;
    page: number;
    pageSize: number;
};

/**
 * HTTP implementation of {@link ActivityGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 * Every event on the page is run through the `toActivityEvent` anti-corruption
 * mapper, and every failure is normalized with `toApiError`, so callers see the
 * admin's `ActivityList` model and `ApiError`, never axios internals. The single
 * place `apiClient` is used in this plugin.
 */
export const httpActivityGateway: ActivityGateway = {
    async list(params: ActivityListParams): Promise<ActivityList> {
        try {
            const { data } = await apiClient.get<ActivityListResponse>(
                '/activity',
                { params }
            );
            return {
                items: data.items.map(toActivityEvent),
                total: data.total,
                page: data.page,
                pageSize: data.pageSize
            };
        } catch (error) {
            throw toApiError(error);
        }
    }
};
