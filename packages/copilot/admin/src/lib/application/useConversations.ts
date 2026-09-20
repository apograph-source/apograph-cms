import { useQuery } from '@tanstack/react-query';
import { apiClient, STALE_TIME } from '@orthacms/utils-admin';

/** A thread as the list renders it. */
export interface CopilotConversation {
    id: string;
    title: string | null;
    surface: string;
    archived: boolean;
    /**
     * The model this thread was last **left on**, in the stored form
     * (`'default'`, or `'<provider>:<model>'`) — and `null` when nobody has
     * picked one, which is deliberately not the same thing. See
     * `readStoredModelChoice`.
     */
    modelChoice: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * Prefix covering **both** of a workspace's thread lists.
 *
 * What to invalidate with. Every write here either adds a thread or moves one
 * between the active and archived lists, so refreshing one and not the other
 * leaves a stale list behind the user's back — and `conversationsKey(id)` is
 * *not* that prefix: its `archived` segment defaults to `false`, making it the
 * exact key of the active list and nothing else.
 */
export const conversationsScopeKey = (workspaceId: string) =>
    ['copilot', 'conversations', workspaceId] as const;

/** Query key for one of a workspace's two thread lists. */
export const conversationsKey = (workspaceId: string, archived = false) =>
    [...conversationsScopeKey(workspaceId), archived] as const;

/**
 * The signed-in user's threads in the open workspace, most recently used first.
 *
 * Reads through the shared `apiClient` — this is an ordinary JSON request, and
 * only the run route needs the bespoke `fetch` transport.
 *
 * `archived` selects **one of two disjoint sets**, mirroring the server: the
 * default list is the active threads, and passing `true` gets the filed-away
 * ones instead. Nothing shows both at once, because "archived" would then mean
 * nothing to the person reading the list.
 */
export function useConversations(
    workspaceId: string | undefined,
    archived = false
) {
    return useQuery({
        queryKey: conversationsKey(workspaceId ?? '', archived),
        enabled: !!workspaceId,
        staleTime: STALE_TIME.Short,
        queryFn: async (): Promise<CopilotConversation[]> => {
            const response = await apiClient.get<{
                items: CopilotConversation[];
            }>('/copilot/conversations', {
                // Omitted entirely for the default: a `?archived=false` on every
                // list request is noise in the log and in the network tab.
                ...(archived ? { params: { archived: true } } : {})
            });
            return response.data.items;
        }
    });
}
