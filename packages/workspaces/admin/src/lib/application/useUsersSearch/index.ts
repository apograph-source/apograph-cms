import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@orthacms/utils-admin';
import type { DirectoryUser } from '../../domain/types/wizard';
import { httpWorkspaceGateway } from '../../infrastructure/httpWorkspaceGateway';

/** Result of {@link useUsersSearch}. */
export type UsersSearchResult = {
    /** Matching directory users (empty until a debounced query resolves). */
    users: DirectoryUser[];
    /** Whether a search is currently in flight. */
    loading: boolean;
    /** Whether the underlying search query failed. */
    isError: boolean;
};

/**
 * Searches the user directory for the member typeahead via the gateway
 * (`GET /api/users`, dropping disabled accounts). Debounces the query (250ms) so
 * each keystroke doesn't fire a request, and only runs once at least one
 * character has been typed.
 */
export function useUsersSearch(query: string): UsersSearchResult {
    const debounced = useDebouncedValue(query.trim(), 250);
    const enabled = debounced.length > 0;

    const result = useQuery({
        queryKey: ['users', 'search', debounced],
        queryFn: () => httpWorkspaceGateway.searchUsers(debounced),
        enabled,
        staleTime: 30_000
    });

    return {
        users: enabled ? (result.data ?? []) : [],
        loading: enabled && (result.isPending || debounced !== query.trim()),
        isError: enabled && result.isError
    };
}
