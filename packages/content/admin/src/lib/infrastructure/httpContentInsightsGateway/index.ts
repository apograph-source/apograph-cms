import { apiClient, toApiError } from '@orthacms/utils-admin';
import type {
    ContentInsightsGateway,
    ContentPipeline,
    ContentPunchcard,
    ContentStale,
    ContentTotals,
    ContentUnshipped,
    ContentVelocity
} from '../contentInsightsGateway';

/**
 * HTTP implementation of {@link ContentInsightsGateway} over the shared
 * `apiClient` — same-origin, cookie-authed, and implicitly workspace-scoped via
 * the ambient `X-Workspace-Id` header. Failures are normalised to `ApiError` so
 * the widgets never see axios internals.
 */
export const httpContentInsightsGateway: ContentInsightsGateway = {
    async totals(days: number): Promise<ContentTotals> {
        try {
            const { data } = await apiClient.get<ContentTotals>(
                '/insights/content/totals',
                { params: { days } }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async stale(): Promise<ContentStale> {
        try {
            const { data } = await apiClient.get<ContentStale>(
                '/insights/content/stale'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async pipeline(): Promise<ContentPipeline> {
        try {
            const { data } = await apiClient.get<ContentPipeline>(
                '/insights/content/pipeline'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async unshipped(): Promise<ContentUnshipped> {
        try {
            const { data } = await apiClient.get<ContentUnshipped>(
                '/insights/content/unshipped'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async punchcard(days: number): Promise<ContentPunchcard> {
        try {
            const { data } = await apiClient.get<ContentPunchcard>(
                '/insights/content/punchcard',
                { params: { days } }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async velocity(days: number): Promise<ContentVelocity> {
        try {
            const { data } = await apiClient.get<ContentVelocity>(
                '/insights/content/velocity',
                { params: { days } }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    }
};
