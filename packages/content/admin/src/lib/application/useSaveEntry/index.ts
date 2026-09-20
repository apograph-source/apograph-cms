import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { EntryRecord } from '../../domain/types/contentType';
import { contentEntryKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';
import type { SaveEntryInput } from '../../infrastructure/contentGateway';
import { refreshEntryCaches } from '../refreshEntryCaches';

export type { SaveEntryInput } from '../../infrastructure/contentGateway';

/** What {@link useSaveEntry} is called with: the request plus cache-flow control. */
export type SaveEntryVariables = SaveEntryInput & {
    /**
     * Skip this save's cache refresh because a **publish** is chained right
     * after it ({@link usePublishEntryFlow}) and will run one pass covering both
     * writes. Without it a Publish click refetches the record and its version
     * timeline twice — once mid-flight against the just-saved draft, then again
     * against the published row. The read-one cache is still primed from the
     * save response, so nothing on screen goes stale in between.
     */
    deferRefresh?: boolean;
};

/**
 * Save mutation for one content type, over the content gateway. Create
 * (`POST /content/:type`) or update (`PATCH /content/:type/:id`) — chosen by
 * whether `id` is present; the server validates and persists the `values` bag and
 * any staged relation deltas in one transaction. A validation failure surfaces as
 * a 422 {@link ApiError} whose `details.issues` the caller maps onto the form.
 * Invalidates the type's records list on success so a created/edited row shows up.
 * Publishing is a separate step ({@link useEntryStatusActions}) so
 * create-then-publish and a standalone publish share the same validated endpoint.
 */
export function useSaveEntry(typeName: string) {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    return useMutation<EntryRecord, ApiError, SaveEntryVariables>({
        mutationFn: (input) => httpContentGateway.saveEntry(typeName, input),
        onSuccess: async (saved, variables) => {
            // The write response **is** the canonical record — the same shape
            // `GET /content/:type/:id` returns, straight off the row it just
            // wrote. Seeding the read-one cache with it (rather than
            // invalidating and re-reading) is what keeps a save from costing a
            // redundant round-trip for a record we were just handed.
            queryClient.setQueryData(
                contentEntryKey(workspace.id, typeName, saved.id),
                saved
            );
            // A chained publish owns the refresh for both writes.
            if (variables.deferRefresh) return;
            // **Awaited**: the editor clears its staged relation overlay when
            // this mutation resolves, so returning before the fresh links landed
            // would render the stale pre-save set (kept via `keepPreviousData`)
            // and flicker the just-linked rows out. Awaiting also keeps the
            // editor's saving overlay up until the screen is current (#7).
            await refreshEntryCaches(queryClient, workspace.id, typeName, {
                primedEntryId: saved.id
            });
        }
    });
}
