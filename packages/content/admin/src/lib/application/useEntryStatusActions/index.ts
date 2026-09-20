import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { EntryRecord } from '../../domain/types/contentType';
import { contentEntryKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';
import { refreshEntryCaches } from '../refreshEntryCaches';

/** One entry to publish, and whether to take a publish guard's way past. */
export type PublishEntryInput = {
    id: string;
    /** Forwarded to the server's publish guards uninterpreted. */
    bypass?: boolean;
};

/**
 * Single-entry lifecycle mutations over the content gateway, shared by the records
 * row menu and the editor sidebar: publish / unpublish (publishable types), and
 * remove / restore / purge (soft-delete lifecycle). Each takes an entry id and
 * invalidates the type's records list on success. Publish can 422 (the stored row
 * fails validation) — callers surface `error.details.issues`.
 */
export function useEntryStatusActions(typeName: string) {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    // Refresh the records list, the read-one, and the version timeline, so the
    // editor's view of a published/unpublished/restored entry stays fresh.
    const invalidate = () =>
        refreshEntryCaches(queryClient, workspace.id, typeName);

    // The status endpoints return the updated record, so seed the read-one cache
    // with it and skip re-reading what the response already carried. Awaited so
    // the caller's `isPending` (and the editor's overlay) spans the refetches.
    const syncFrom = async (record: EntryRecord) => {
        queryClient.setQueryData(
            contentEntryKey(workspace.id, typeName, record.id),
            record
        );
        await refreshEntryCaches(queryClient, workspace.id, typeName, {
            primedEntryId: record.id
        });
    };

    const publish = useMutation<EntryRecord, ApiError, PublishEntryInput>({
        mutationFn: ({ id, bypass }) =>
            httpContentGateway.publish(typeName, id, { bypass }),
        onSuccess: syncFrom
    });

    const unpublish = useMutation<EntryRecord, ApiError, string>({
        mutationFn: (id) => httpContentGateway.unpublish(typeName, id),
        onSuccess: syncFrom
    });

    // Delete/purge leave no record to seed — drop the read-one along with
    // everything else.
    const remove = useMutation<void, ApiError, string>({
        mutationFn: (id) => httpContentGateway.remove(typeName, id),
        onSuccess: invalidate
    });

    const restore = useMutation<EntryRecord, ApiError, string>({
        mutationFn: (id) => httpContentGateway.restore(typeName, id),
        onSuccess: syncFrom
    });

    const purge = useMutation<void, ApiError, string>({
        mutationFn: (id) => httpContentGateway.purge(typeName, id),
        onSuccess: invalidate
    });

    return { publish, unpublish, remove, restore, purge };
}
