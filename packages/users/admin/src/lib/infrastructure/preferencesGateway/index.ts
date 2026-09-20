import { apiClient, toApiError } from '@orthacms/utils-admin';
import type { ThemePreference } from '@orthacms/design-system';

/**
 * The current user's own preferences, as carried over `/api/preferences`.
 * Today that is just the colour theme; the object shape leaves room for more
 * self-service preferences without changing the endpoint contract.
 */
export type UserPreferences = {
    /** The user's chosen colour theme. */
    theme: ThemePreference;
};

/**
 * React Query keys for a user's own preferences. Distinct from `membersKeys` —
 * these are the caller's *own* app preferences, not a member record, so they
 * never invalidate alongside the members list.
 *
 * The key is scoped **by user id**, not a flat `'me'`. Sign-out only invalidates
 * the current-user query; every other cache entry survives it. With a shared
 * `'me'` key, signing in as someone else on the same machine would read the
 * previous user's cached theme (and, because this query never goes stale, never
 * refetch to correct it). Scoping by id makes that structurally impossible.
 */
export const preferencesKeys = {
    /** One user's preferences. */
    forUser: (userId: string) => ['preferences', userId] as const
};

/**
 * The one place `/api/preferences` is spoken to. Keeps `apiClient` out of the
 * application hooks (per this plugin's layering) and normalizes transport
 * errors to `ApiError` so callers branch on status, not axios internals.
 */
export const httpPreferencesGateway = {
    /** Reads the signed-in user's preferences (defaults if never saved). */
    async get(): Promise<UserPreferences> {
        try {
            const response =
                await apiClient.get<UserPreferences>('/preferences');
            return response.data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    /** Persists the signed-in user's theme choice, returning the stored row. */
    async updateTheme(theme: ThemePreference): Promise<UserPreferences> {
        try {
            const response = await apiClient.put<UserPreferences>(
                '/preferences',
                { theme }
            );
            return response.data;
        } catch (error) {
            throw toApiError(error);
        }
    }
};
