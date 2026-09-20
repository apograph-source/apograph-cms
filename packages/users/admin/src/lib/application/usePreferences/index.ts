import { useQuery } from '@tanstack/react-query';
import { AuthStatus, useAuth } from '@orthacms/identity-admin';
import {
    httpPreferencesGateway,
    preferencesKeys,
    type UserPreferences
} from '../../infrastructure/preferencesGateway';

/**
 * Reads the signed-in user's stored preferences via the gateway. It resolves the
 * caller from `useAuth` itself rather than taking an `enabled` flag, so every
 * consumer is automatically keyed to — and gated on — the right user: the query
 * stays disabled until auth resolves (the endpoint 401s otherwise) and its cache
 * entry is scoped by user id, so a second sign-in on the same machine can't read
 * the first user's theme.
 *
 * The result seeds both the Preferences tab and the app-wide theme hydration, so
 * `staleTime: Infinity` keeps it from refetching under the two consumers — the
 * mutation writes the cache directly on save.
 */
export function usePreferences() {
    const auth = useAuth();
    const userId =
        auth.status === AuthStatus.Authenticated ? auth.user.id : undefined;

    return useQuery<UserPreferences>({
        // The empty-string key is never actually read — `enabled` is false until
        // a real id resolves.
        queryKey: preferencesKeys.forUser(userId ?? ''),
        queryFn: () => httpPreferencesGateway.get(),
        enabled: !!userId,
        staleTime: Infinity,
        retry: false
    });
}
