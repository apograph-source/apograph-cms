import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { EntryRecord } from '../../domain/types/contentType';
import { contentEntryKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    contentEntryKey,
    contentEntryPrefix
} from '../../infrastructure/contentKeys';

/**
 * Reads one entry for the editor's edit mode via the content gateway.
 * `initialData` (seeded from the records-list cache when the row was opened from
 * the table) keeps the form instant on the common path; a deep link / reload
 * with no cache simply fetches. Disabled when there's no id. The cache key is
 * workspace-scoped.
 *
 * **`staleTime`** stops the editor re-reading a record it was *just handed*. Two
 * paths seed this cache with a canonical copy — every entry write primes it with
 * the server's response, and a create then navigates to `/:type/:id`, mounting
 * this query — and with no `staleTime` that fresh record was thrown away and
 * re-fetched on arrival, so every save cost an extra round-trip for data already
 * in hand. Correctness is unaffected: writes still invalidate (which ignores
 * `staleTime`), so nothing this app changes can go unnoticed. `initialDataUpdatedAt`
 * is what keeps that honest for cache-seeded opens — list data carries the age of
 * the list read, so a stale row refetches instead of being trusted for another
 * window.
 */
export function useContentEntry(
    name: string,
    id: string | undefined,
    options: {
        initialData?: EntryRecord;
        /** When the `initialData` was fetched (epoch ms) — its real age, not now. */
        initialDataUpdatedAt?: number;
        enabled?: boolean;
    } = {}
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: contentEntryKey(workspace.id, name, id ?? ''),
        queryFn: () => httpContentGateway.getEntry(name, id as string),
        enabled: (options.enabled ?? true) && !!id,
        initialData: options.initialData,
        initialDataUpdatedAt: options.initialDataUpdatedAt,
        staleTime: STALE_TIME.Short
    });
}
