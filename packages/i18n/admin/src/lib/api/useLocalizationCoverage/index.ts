import { useQuery } from '@tanstack/react-query';
import { apiClient, STALE_TIME, toApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { CONTENT_READ, I18N_COVERAGE_PATH } from '../../constants';
import type { I18nCoverageResult } from '../../types/locale';

/**
 * Query key of the coverage read.
 *
 * Workspace-scoped like every content key: the workspace reaches the server
 * only as an ambient `X-Workspace-Id` header, which is never sent on a cache
 * hit — so without the id here, switching workspaces would show the previous
 * one's coverage and never refetch.
 */
export const localizationCoverageKey = (workspaceId: string) =>
    ['i18n-coverage', workspaceId] as const;

/** Reads `GET /api/insights/i18n/coverage`. */
async function fetchCoverage(): Promise<I18nCoverageResult> {
    try {
        const { data } =
            await apiClient.get<I18nCoverageResult>(I18N_COVERAGE_PATH);
        return data;
    } catch (error) {
        throw toApiError(error);
    }
}

/**
 * Localization coverage for the Insights widget: per-locale translation counts
 * plus the fully-localized / untranslated / needs-work totals.
 *
 * Takes no range — an untranslated record is untranslated regardless of when it
 * was written, so a window could only hide part of the backlog.
 */
export function useLocalizationCoverage() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: localizationCoverageKey(workspace.id),
        queryFn: fetchCoverage,
        staleTime: STALE_TIME.Standard,
        // One retry, not TanStack's default three — the Insights convention.
        // Three attempts with exponential backoff leave a broken widget on a
        // skeleton for about seven seconds, which reads as a hang rather than
        // the failure it is.
        retry: 1,
        enabled: canRead
    });
}
