import { useQuery } from '@tanstack/react-query';
import { apiClient, toApiError } from '@ortha/utils-admin';
import { activityKeys } from '../../infrastructure/activityKeys';

/** One event that could not be recorded, as the server reports it. */
export interface DeadLetter {
    /** The event id — the handle an operator replays it by. */
    id: string;
    /** The event kind that could not be delivered. */
    kind: string;
    /** The aggregate root's type. */
    aggregateType: string;
    /** The aggregate root's id. */
    aggregateId: string;
    /** When the fact occurred (ISO-8601 on the wire). */
    occurredAt: string;
    /** How many delivery attempts were spent before it parked. */
    attempts: number;
    /** Why the last attempt failed. */
    lastError: string | null;
}

/** The envelope `GET /api/activity/dead-letters` returns. */
export interface DeadLetterList {
    /** How many events have given up in total. */
    total: number;
    /** The most recent of them. */
    items: DeadLetter[];
}

/**
 * How many events could not be recorded — the completeness of the log the page
 * is showing.
 *
 * Its own query rather than part of `useActivityLog`, for the reason every
 * widget on the Insights page owns its own request: this is a caveat about the
 * list, and a caveat that fails must not take the list down with it. A page
 * that renders no rows because the *warning* about the rows errored is strictly
 * worse than one that renders the rows without the warning.
 *
 * Disabled until the caller confirms `activity:read` — the same key the route
 * is gated on.
 */
export function useDeadLetters(enabled = true) {
    return useQuery({
        queryKey: activityKeys.deadLetters(),
        queryFn: async (): Promise<DeadLetterList> => {
            try {
                const { data } = await apiClient.get<DeadLetterList>(
                    '/activity/dead-letters',
                    { params: { limit: 5 } }
                );
                return data;
            } catch (error) {
                throw toApiError(error);
            }
        },
        enabled
    });
}
