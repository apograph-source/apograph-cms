import { apiClient, toApiError } from '@orthacms/utils-admin';
import type {
    MediaAltCoverage,
    MediaInsightsGateway,
    MediaStorage,
    MediaUploads
} from '../mediaInsightsGateway';

/**
 * HTTP implementation of {@link MediaInsightsGateway} over the shared
 * `apiClient` — same-origin, cookie-authed, implicitly workspace-scoped via the
 * ambient `X-Workspace-Id` header. Failures normalise to `ApiError`.
 */
export const httpMediaInsightsGateway: MediaInsightsGateway = {
    async storage(): Promise<MediaStorage> {
        try {
            const { data } = await apiClient.get<MediaStorage>(
                '/insights/media/storage'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async uploads(days: number): Promise<MediaUploads> {
        try {
            const { data } = await apiClient.get<MediaUploads>(
                '/insights/media/uploads',
                { params: { days } }
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async altCoverage(): Promise<MediaAltCoverage> {
        try {
            const { data } = await apiClient.get<MediaAltCoverage>(
                '/insights/media/alt'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    }
};
