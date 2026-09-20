import { useQuery } from '@tanstack/react-query';
import { apiClient, toApiError } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { I18N_CONTENT_PATH } from '../../constants';
import type { EntryLocalesResult } from '../../types/locale';

/** Query key of one entry's locale panel, workspace-scoped. */
export const entryLocalesKey = (
    workspaceId: string,
    typeName: string,
    entryId: string
) => ['i18n-entry-locales', workspaceId, typeName, entryId] as const;

/**
 * Query-key prefix for **all** of a workspace's entry-locale panels of a type
 * — used to invalidate after a translation is created.
 */
export const entryLocalesPrefix = (workspaceId: string, typeName: string) =>
    ['i18n-entry-locales', workspaceId, typeName] as const;

/** Loads one entry's locale panel from `GET /api/i18n/content/:type/:id/locales`. */
async function fetchEntryLocales(
    typeName: string,
    entryId: string
): Promise<EntryLocalesResult> {
    try {
        const { data } = await apiClient.get<EntryLocalesResult>(
            `${I18N_CONTENT_PATH}/${typeName}/${entryId}/locales`
        );
        return data;
    } catch (error) {
        throw toApiError(error);
    }
}

/**
 * The locale panel of one entry: every configured locale with the
 * translation group's row in it (id, status, updatedAt) or null. Drives the
 * entry editor's locale widget.
 */
export function useEntryLocales(
    typeName: string,
    entryId: string | undefined,
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: entryLocalesKey(workspace.id, typeName, entryId ?? ''),
        enabled: enabled && !!entryId,
        // Guarded by `enabled`, so the id is always defined here.
        queryFn: () => fetchEntryLocales(typeName, entryId as string)
    });
}
