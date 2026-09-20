import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { EntryRecord } from '../../domain/types/contentType';
import { contentEntryKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';
import { refreshEntryCaches } from '../refreshEntryCaches';

/**
 * Revision actions for one entry, over the content gateway — **restore** and
 * **publish a specific version**. Both are append-only and mutate the same
 * surfaces a save does, so each invalidates the timeline, the entry read-one
 * (Details/status), the records list, and the relation caches.
 *
 * - `restore` (`POST …/revisions/:number/restore`) re-applies an earlier snapshot
 *   onto the live row as a **new draft** revision.
 * - `publish` (`POST …/revisions/:number/publish`) makes a chosen version live:
 *   the newest publishes in place, an earlier one is restored then published, so
 *   its content becomes the live/published version (the prior one superseded).
 *   Can reject with a 422 when the version fails the publish gate.
 */
export function useRevisionActions(typeName: string, id: string | undefined) {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();

    // Both endpoints return the resulting record, so seed the read-one cache with
    // it and let the shared pass refresh everything else.
    const invalidate = async (saved: EntryRecord) => {
        queryClient.setQueryData(
            contentEntryKey(workspace.id, typeName, saved.id),
            saved
        );
        await refreshEntryCaches(queryClient, workspace.id, typeName, {
            primedEntryId: saved.id
        });
    };

    const restore = useMutation<EntryRecord, ApiError, number>({
        mutationFn: (number) => {
            if (!id) {
                return Promise.reject(
                    new Error('Cannot restore a revision on an unsaved entry.')
                );
            }
            return httpContentGateway.restoreRevision(typeName, id, number);
        },
        onSuccess: invalidate
    });

    const publish = useMutation<EntryRecord, ApiError, number>({
        mutationFn: (number) => {
            if (!id) {
                return Promise.reject(
                    new Error('Cannot publish a revision on an unsaved entry.')
                );
            }
            return httpContentGateway.publishRevision(typeName, id, number);
        },
        onSuccess: invalidate
    });

    return {
        /** Restore the entry to revision `number` (appends a new revision). */
        restore: restore.mutate,
        /** Whether a restore is in flight. */
        restoring: restore.isPending,
        /** The last restore error, if any (surfaced by the widget as a toast). */
        restoreError: restore.error,
        /** Publish revision `number` live (restore-if-needed + publish). */
        publish: publish.mutate,
        /** Whether a publish-version is in flight. */
        publishing: publish.isPending,
        /** The last publish-version error, if any. */
        publishError: publish.error
    };
}
