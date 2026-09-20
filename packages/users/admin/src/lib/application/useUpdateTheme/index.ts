import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import type { ThemePreference } from '@orthacms/design-system';
import { AuthStatus, useAuth } from '@orthacms/identity-admin';
import {
    httpPreferencesGateway,
    preferencesKeys,
    type UserPreferences
} from '../../infrastructure/preferencesGateway';

/**
 * Persists the signed-in user's theme choice via the gateway. On success it
 * writes the returned preferences straight into the query cache — no
 * invalidation/refetch — so the tab and the app-wide theme hydration stay in
 * lockstep with the server without an extra round-trip. It resolves the caller
 * from `useAuth` for the same reason {@link usePreferences} does: the cache entry
 * it writes must be the one scoped to *this* user. Errors are already normalized
 * to {@link ApiError} by the gateway, so the page can surface a toast.
 */
export function useUpdateTheme() {
    const queryClient = useQueryClient();
    const auth = useAuth();
    const userId =
        auth.status === AuthStatus.Authenticated ? auth.user.id : undefined;

    return useMutation<UserPreferences, ApiError, ThemePreference>({
        mutationFn: (theme) => httpPreferencesGateway.updateTheme(theme),
        onSuccess: (preferences) => {
            if (userId) {
                queryClient.setQueryData(
                    preferencesKeys.forUser(userId),
                    preferences
                );
            }
        }
    });
}
