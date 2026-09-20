import { apiClient, toApiError } from '@orthacms/utils-admin';
import type { SavedView } from '../../domain/types/savedView';
import type {
    CreateViewInput,
    SavedViewsGateway,
    UpdateViewInput
} from '../savedViewsGateway';

/**
 * HTTP implementation of {@link SavedViewsGateway} over the shared `apiClient`.
 * The one place `/views` is spoken to; every error is normalized through
 * `toApiError` so callers see the same shape the rest of the admin does.
 *
 * The wire shape and the view model are identical here — a saved view is
 * already the admin's own concept, so there is no mapper to write. Adding one
 * that only copies fields would be ceremony, not an anti-corruption layer.
 */
export const httpSavedViewsGateway: SavedViewsGateway = {
    async list(scope) {
        try {
            const { data } = await apiClient.get<SavedView[]>('/views', {
                params: { scope }
            });
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async create(input: CreateViewInput) {
        try {
            const { data } = await apiClient.post<SavedView>('/views', input);
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async update(id: string, input: UpdateViewInput) {
        try {
            const { data } = await apiClient.patch<SavedView>(
                `/views/${id}`,
                input
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async remove(id: string) {
        try {
            await apiClient.delete(`/views/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async setDefault(id: string) {
        try {
            await apiClient.put(`/views/${id}/default`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async clearDefault(id: string) {
        try {
            await apiClient.delete(`/views/${id}/default`);
        } catch (error) {
            throw toApiError(error);
        }
    }
};
