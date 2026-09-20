import { useQuery } from '@tanstack/react-query';
import { apiClient, toApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { I18N_CONTENT_PATH } from '../../constants';
import type {
    LocaleSummariesResult,
    LocaleSummaryItem
} from '../../types/locale';

/** What the Locales column's cells consume — the per-group member map. */
export type LocaleSummariesData = {
    /** Live members per translation-group id (empty array = group unknown). */
    groups: Record<string, LocaleSummaryItem[]>;
    /** Whether the batch read is still in flight. */
    isPending: boolean;
    /**
     * Whether the batch read **failed**. Without it a failed batch is
     * indistinguishable from "this record has no other locales" — the cell
     * renders empty either way, which is the error-masquerading-as-empty
     * pattern on the one column whose whole job is to say what exists.
     */
    isError: boolean;
    /** Retry the batch, for an error affordance. */
    refetch: () => void;
};

/** Query key of one page's locale summaries, workspace-scoped. */
export const localeSummariesKey = (
    workspaceId: string,
    typeName: string,
    groupIds: readonly string[]
) => ['i18n-locale-summaries', workspaceId, typeName, groupIds] as const;

/**
 * Query-key prefix of a type's locale summaries — invalidated after a
 * translation is created/deleted so the table column refreshes.
 */
export const localeSummariesPrefix = (workspaceId: string, typeName: string) =>
    ['i18n-locale-summaries', workspaceId, typeName] as const;

/** Batch-loads group summaries via `POST /api/i18n/content/:type/locale-summary`. */
async function fetchLocaleSummaries(
    typeName: string,
    groupIds: string[]
): Promise<LocaleSummariesResult> {
    try {
        const { data } = await apiClient.post<LocaleSummariesResult>(
            `${I18N_CONTENT_PATH}/${typeName}/locale-summary`,
            { groupIds }
        );
        return data;
    } catch (error) {
        throw toApiError(error);
    }
}

/**
 * The locale summaries for one records-table page: one batched request over
 * the page's unique translation-group ids (never per row). Sorted ids key the
 * cache, so row reordering within a page is a cache hit. Disabled until
 * `enabled` (the schema is i18n) and there's something to summarize.
 */
export function useLocaleSummaries(
    typeName: string,
    groupIds: readonly (string | undefined)[],
    enabled = true
): LocaleSummariesData {
    const workspace = useCurrentWorkspace();
    const uniqueIds = [
        ...new Set(groupIds.filter((id): id is string => !!id))
    ].sort();
    const query = useQuery({
        queryKey: localeSummariesKey(workspace.id, typeName, uniqueIds),
        enabled: enabled && uniqueIds.length > 0,
        queryFn: () => fetchLocaleSummaries(typeName, uniqueIds)
    });
    const active = enabled && uniqueIds.length > 0;
    return {
        groups: query.data?.groups ?? {},
        isPending: active && query.isPending,
        isError: active && query.isError,
        refetch: () => void query.refetch()
    };
}
