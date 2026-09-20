import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import { conversationKey } from './useConversation';
import {
    conversationsScopeKey,
    type CopilotConversation
} from './useConversations';

/** What one PATCH may change. All optional; the server rejects an empty body. */
export interface ConversationPatch {
    /** A new display title. */
    title?: string;
    /** Hide the thread from the list, or bring it back. */
    archived?: boolean;
    /**
     * Record the model picked for this thread, so reopening it in another tab
     * offers that backend rather than the deployment default. `'default'`, or
     * `'<provider>:<model>'` — see `storedModelChoice`.
     */
    modelChoice?: string;
}

/**
 * Renames a thread, files it away, or records the model picked for it.
 *
 * `PATCH /copilot/conversations/:id`. Always invalidates that thread's own
 * transcript key, whose cached copy carries both the title and the model.
 *
 * The **thread-list** keys — active and archived, invalidated together, because
 * a rename or an archive moves a row between two lists and refreshing only the
 * one on screen leaves the other stale — are invalidated **only when the patch
 * changed something a list shows**. A model choice is not: refetching both rails
 * every time somebody opens the picker is two requests for a rail that would
 * redraw identically.
 */
export function useUpdateConversation(workspaceId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            conversationId,
            patch
        }: {
            conversationId: string;
            patch: ConversationPatch;
        }) => {
            const { data } = await apiClient.patch<CopilotConversation>(
                `/copilot/conversations/${conversationId}`,
                patch
            );
            return data;
        },
        onSuccess: (_data, { conversationId, patch }) => {
            if (patch.title !== undefined || patch.archived !== undefined) {
                void queryClient.invalidateQueries({
                    queryKey: conversationsScopeKey(workspaceId)
                });
            }
            void queryClient.invalidateQueries({
                queryKey: conversationKey(conversationId)
            });
        }
    });
}
