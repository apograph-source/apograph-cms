import { useQuery } from '@tanstack/react-query';
import { type ApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { RevisionDetail } from '../../domain/types/contentType';
import { revisionDetailKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

/**
 * Reads one revision's full snapshot body (`GET /content/:type/:id/revisions/:number`),
 * for the preview / compare view. Gated on a saved entry id **and** a revision
 * number, so it stays idle until a version is actually opened. A revision is
 * immutable, so the cache never goes stale on its own — an
 * `entryRevisionsPrefix` invalidation (save / restore / publish) is the only
 * thing that drops it.
 */
export function useRevisionDetail(
    typeName: string,
    id: string | undefined,
    number: number | undefined
) {
    const workspace = useCurrentWorkspace();
    return useQuery<RevisionDetail, ApiError>({
        queryKey: revisionDetailKey(
            workspace.id,
            typeName,
            id ?? '',
            number ?? 0
        ),
        queryFn: () =>
            httpContentGateway.getRevision(
                typeName,
                id as string,
                number as number
            ),
        enabled: !!id && number != null,
        staleTime: Infinity
    });
}
