import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '../../infrastructure/activityKeys';

/**
 * Ask the dead-letter list again — **both** pages of it.
 *
 * There is one list of parked events and two cache entries holding it: the
 * banner's five rows and the dialog's fifty, keyed apart by their `limit`. Any
 * moment the client learns the list has moved, both have to hear it. Refetching
 * one leaves the other reporting rows it has just been told are gone — the
 * banner kept saying "3 actions were not recorded", and naming the missing
 * kinds, after a refused retry had already refreshed the dialog underneath it.
 *
 * So this invalidates the shared `deadLettersRoot` **prefix**, which is exactly
 * what `useRetryDeadLetter`'s success path does. It is the same
 * invalidation for the same reason, and having it in one place is what stops
 * the two paths drifting apart again.
 *
 * **Still precise**: the prefix covers the two dead-letter entries and nothing
 * else. Not `activityKeys.all`, and specifically not the log list — a refused
 * retry changed no audit row, so refetching every cached log page would be a
 * refetch storm for a change that never happened.
 *
 * An entry with no live observer — the dialog's page while the dialog is
 * closed — is marked stale rather than refetched, so it is fresh the next time
 * it is opened without a request nobody is waiting on.
 */
export function useRefreshDeadLetters(): () => void {
    const queryClient = useQueryClient();

    return useCallback(() => {
        void queryClient.invalidateQueries({
            queryKey: activityKeys.deadLettersRoot
        });
    }, [queryClient]);
}
