import { useQuery } from '@tanstack/react-query';
import { apiClient, toApiError } from '@orthacms/utils-admin';
import { toActivityEvent } from '../../infrastructure/activityMapper';
import type { ActivityEventResponse } from '../../infrastructure/activityMapper';
import { activityKeys } from '../../infrastructure/activityKeys';
import type { ActivityList } from '../../types/activityEvent';

/** The paginated envelope `GET /api/activity/entries/:entryId` returns. */
type EntryActivityResponse = {
    items: ActivityEventResponse[];
    total: number;
    page: number;
    pageSize: number;
};

/**
 * One entry's own audit trail — created, edited, published, taken down,
 * deleted, restored, and who may read it.
 *
 * It hits a **different route with a different permission** from the rest of
 * this plugin. `GET /activity` is `activity:read`, admin-only, and it should
 * stay that way: it carries invites, role changes and sign-in failures for the
 * whole deployment. `GET /activity/entries/:id` is `content:read` and returns
 * only rows about an entry the caller may already open, which is what lets an
 * **editor** see the history of their own content.
 *
 * Runs through the same `toActivityEvent` mapper as the log, so the widget and
 * the page render the same model.
 */
export function useEntryActivity(
    entryId: string | undefined,
    pageSize: number,
    enabled = true
) {
    return useQuery({
        queryKey: activityKeys.entry(entryId ?? '', pageSize),
        queryFn: async (): Promise<ActivityList> => {
            try {
                const { data } = await apiClient.get<EntryActivityResponse>(
                    `/activity/entries/${entryId}`,
                    { params: { pageSize } }
                );
                return {
                    items: data.items.map(toActivityEvent),
                    total: data.total,
                    page: data.page,
                    pageSize: data.pageSize
                };
            } catch (error) {
                throw toApiError(error);
            }
        },
        enabled: enabled && Boolean(entryId)
    });
}
