import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpActivityGateway } from '../../infrastructure/httpActivityGateway';
import { activityKeys } from '../../infrastructure/activityKeys';
import type { RetriedDeadLetter } from '../../types/deadLetter';

/** What {@link useRetryDeadLetter} is called with — the parked event's id. */
export type RetryDeadLetterInput = {
    /** The outbox event id. Carried as an object so `variables.id` can scope
     *  the pending state to the row that was pressed. */
    id: string;
};

/**
 * Puts one parked event back in the queue.
 *
 * **Not optimistic.** The row is not removed locally on success: the retention
 * sweep that shipped with this route can change the list underneath the reader
 * in both directions, so a local guess is wrong as often as it is right. The
 * mutation invalidates and the row leaves when the refetch lands.
 *
 * **Invalidates exactly the dead-letter queries** — `deadLettersRoot`, which
 * covers the banner's five rows and the dialog's fifty and nothing else. Not
 * `activityKeys.all`, and specifically **not** the activity log list: the
 * retried event has not been delivered yet, so refetching every cached log page
 * would be a refetch storm for a change that has not happened. When it does
 * deliver, the new `outbox.event_retried` row arrives with the next log fetch
 * like any other.
 *
 * Needs `activity:manage`; the caller renders the control only when the user
 * holds it.
 */
export function useRetryDeadLetter() {
    const queryClient = useQueryClient();

    return useMutation<RetriedDeadLetter, Error, RetryDeadLetterInput>({
        mutationFn: ({ id }) => httpActivityGateway.retryDeadLetter(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: activityKeys.deadLettersRoot
            });
        }
    });
}
