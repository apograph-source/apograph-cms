import { apiClient, toApiError } from '@orthacms/utils-admin';
import type { ActivityList } from '../../types/activityEvent';
import type { DeadLetterList, RetriedDeadLetter } from '../../types/deadLetter';
import { toActivityEvent, type ActivityEventResponse } from '../activityMapper';
import {
    toDeadLetter,
    toRetriedDeadLetter,
    type DeadLetterListResponse,
    type RetriedDeadLetterResponse
} from '../deadLetterMapper';
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
 * Everything it fetches is run through the anti-corruption mappers, and every
 * failure is normalized with `toApiError`, so callers see the admin's view
 * models and `ApiError`, never axios internals. The single place `apiClient` is
 * used in this plugin.
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
    },

    async deadLetters(limit: number): Promise<DeadLetterList> {
        try {
            const { data } = await apiClient.get<DeadLetterListResponse>(
                '/activity/dead-letters',
                { params: { limit } }
            );
            return {
                total: data.total,
                items: data.items.map(toDeadLetter)
            };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async retryDeadLetter(id: string): Promise<RetriedDeadLetter> {
        try {
            // 200, not 201: the row that comes back is the one that was
            // already there, reset in place. It keeps its id, because that id
            // is what every subscriber deduplicates on.
            const { data } = await apiClient.post<RetriedDeadLetterResponse>(
                `/activity/dead-letters/${id}/retry`
            );
            return toRetriedDeadLetter(data);
        } catch (error) {
            throw toApiError(error);
        }
    }
};
