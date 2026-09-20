import { useQuery } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { RevisionListView } from '../../domain/types/contentType';
import { entryRevisionsKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

/**
 * Reads one entry's revision timeline (`GET /content/:type/:id/revisions`,
 * newest first). Workspace-scoped and gated on a saved entry — a create form has
 * no id (and no history) yet, so the query stays idle until `id` is present.
 */
export function useEntryRevisions(typeName: string, id: string | undefined) {
    const workspace = useCurrentWorkspace();
    return useQuery<RevisionListView, ApiError>({
        queryKey: entryRevisionsKey(workspace.id, typeName, id ?? ''),
        queryFn: () => httpContentGateway.listRevisions(typeName, id as string),
        enabled: !!id
    });
}
