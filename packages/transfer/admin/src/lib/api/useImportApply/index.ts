import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import { refreshEntryCaches } from '@orthacms/content-admin';
import type { ImportResult } from '@orthacms/transfer-domain';
import { importFormData, type ImportOptions } from '../useImportPreview';

/** One apply request. */
export interface ImportApplyRequest extends ImportOptions {
    typeName: string;
    /** The open workspace — the caches are scoped to it. */
    workspaceId: string;
    file: File;
}

/**
 * Applies an import, then refreshes the content caches so the new rows appear.
 *
 * **Every type the run touched**, not just the collection whose Import button
 * was pressed. That is the point of carrying relations: one import can create
 * an article *and* the author it points at, and refreshing only the article
 * list leaves the authors list showing pre-import data with nothing to tell the
 * reader it is stale. The verdicts name every type that was written, so the set
 * is exact rather than guessed.
 *
 * It goes through `refreshEntryCaches` — content's own one-pass refresh — rather
 * than a key spelled here. This used to invalidate `['content']`, which matches
 * **nothing**: the library's roots are `content-entries` / `content-entry` / …,
 * TanStack compares whole segments, and `'content' !== 'content-entries'`. The
 * import succeeded, the toast said so, and the table never moved.
 */
export function useImportApply() {
    const queryClient = useQueryClient();
    return useMutation<ImportResult, unknown, ImportApplyRequest>({
        mutationFn: ({ typeName, workspaceId, file, ...options }) =>
            apiClient
                .post<ImportResult>(
                    `/content/${typeName}/import`,
                    importFormData(file, options)
                )
                .then((response) => response.data),
        onSuccess: async (result, { typeName, workspaceId }) => {
            const touched = new Set(
                result.verdicts.map((verdict) => verdict.$type)
            );
            // The collection that was imported into, always — a run in which
            // every record errored still leaves the list worth re-reading.
            touched.add(typeName);
            await Promise.all(
                [...touched].map((name) =>
                    refreshEntryCaches(queryClient, workspaceId, name)
                )
            );
            // `['media', workspaceId, …]` — a plain prefix here, and it does
            // match. An archive import uploads assets.
            await queryClient.invalidateQueries({ queryKey: ['media'] });
        }
    });
}
