import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type {
    BulkActionResult,
    BulkPublishPreview,
    BulkPublishResult
} from '../../domain/types/contentType';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';
import { refreshEntryCaches } from '../refreshEntryCaches';

/**
 * Bulk actions over a selected set of entry ids, via the content gateway, shared
 * by the records selection bar **and** by the i18n plugin's publish/unpublish
 * all locales menu items. `previewPublish` is a read (validates each id, writes
 * nothing) and so doesn't invalidate; the committing actions run the shared
 * {@link refreshEntryCaches} pass on success. Each mutation takes the `ids` array.
 *
 * It is the **shared** pass and not just the records list because a bulk action
 * can be fired from the editor of a record inside the set: "publish all locales"
 * publishes the open record along with its siblings, and refreshing only the list
 * left the editor's Details block reading its pre-publish cache — a record that
 * had just gone live still showing **Modified**. No id is primed: the bulk
 * responses carry verdicts, not records, so every read-one of the type is dropped.
 */
export function useBulkEntryActions(typeName: string) {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    const invalidate = () =>
        refreshEntryCaches(queryClient, workspace.id, typeName);

    const previewPublish = useMutation<BulkPublishPreview, ApiError, string[]>({
        mutationFn: (ids) =>
            httpContentGateway.bulkPreviewPublish(typeName, ids)
    });

    const publish = useMutation<BulkPublishResult, ApiError, string[]>({
        mutationFn: (ids) => httpContentGateway.bulkPublish(typeName, ids),
        onSuccess: invalidate
    });

    const unpublish = useMutation<BulkActionResult, ApiError, string[]>({
        mutationFn: (ids) => httpContentGateway.bulkUnpublish(typeName, ids),
        onSuccess: invalidate
    });

    const remove = useMutation<BulkActionResult, ApiError, string[]>({
        mutationFn: (ids) => httpContentGateway.bulkRemove(typeName, ids),
        onSuccess: invalidate
    });

    const restore = useMutation<BulkActionResult, ApiError, string[]>({
        mutationFn: (ids) => httpContentGateway.bulkRestore(typeName, ids),
        onSuccess: invalidate
    });

    const purge = useMutation<BulkActionResult, ApiError, string[]>({
        mutationFn: (ids) => httpContentGateway.bulkPurge(typeName, ids),
        onSuccess: invalidate
    });

    return { previewPublish, publish, unpublish, remove, restore, purge };
}
