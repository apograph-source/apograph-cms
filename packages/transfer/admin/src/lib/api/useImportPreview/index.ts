import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import type {
    ConflictPolicy,
    ImportPreview,
    RelationPolicy
} from '@orthacms/transfer-domain';

/** The settings both import routes take, as the dialog holds them. */
export interface ImportOptions {
    /** What to do with a selected record that already exists here. */
    policy: ConflictPolicy;
    /** What to do with the related records the file carries. */
    relations: RelationPolicy;
}

/** One dry-run request. */
export interface ImportPreviewRequest extends ImportOptions {
    typeName: string;
    file: File;
}

/** Builds the multipart body both import routes take. */
export function importFormData(file: File, options: ImportOptions): FormData {
    const form = new FormData();
    form.append('file', file);
    form.append('policy', options.policy);
    form.append('relations', options.relations);
    return form;
}

/**
 * Dry-runs an import.
 *
 * A mutation rather than a query even though it writes nothing: it is driven by
 * a file the user just picked, it should never be retried or refetched on its
 * own, and caching a result keyed on a `File` is not a thing that works.
 */
export function useImportPreview() {
    return useMutation<ImportPreview, unknown, ImportPreviewRequest>({
        mutationFn: ({ typeName, file, ...options }) =>
            apiClient
                .post<ImportPreview>(
                    `/content/${typeName}/import/preview`,
                    importFormData(file, options)
                )
                .then((response) => response.data)
    });
}
