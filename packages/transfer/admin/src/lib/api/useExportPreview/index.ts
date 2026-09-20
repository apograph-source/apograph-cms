import { useQuery } from '@tanstack/react-query';
import { apiClient, STALE_TIME } from '@orthacms/utils-admin';
import type { TransferDepth, TransferFormat } from '@orthacms/transfer-domain';
import { transferKeys } from '../../constants';

/** What the server reports an export would carry. */
export interface ExportPreview {
    roots: number;
    related: number;
    assets: number;
    assetBytes: number;
    /** Whether the chosen format will actually carry those bytes. */
    carriesFileBytes: boolean;
}

function fetchPreview(
    typeName: string,
    ids: readonly string[],
    depth: TransferDepth,
    format: TransferFormat
): Promise<ExportPreview> {
    return apiClient
        .post<ExportPreview>(`/content/${typeName}/export/preview`, {
            ids,
            format,
            depth
        })
        .then((response) => response.data);
}

/**
 * Counts what an export would carry, live as the depth toggles move.
 *
 * The whole point of the dialog: "include related records" reads as harmless
 * and can be the difference between 40 records and 4,000. `enabled` keeps it
 * from firing while the dialog is closed — this runs the *same* graph walk the
 * export does, so it is not free.
 */
export function useExportPreview(
    typeName: string,
    ids: readonly string[],
    depth: TransferDepth,
    format: TransferFormat,
    enabled: boolean
) {
    return useQuery({
        queryKey: transferKeys.exportPreview(
            typeName,
            ids,
            depth as unknown as Record<string, boolean>,
            format
        ),
        queryFn: () => fetchPreview(typeName, ids, depth, format),
        enabled: enabled && ids.length > 0,
        // Short rather than None: toggling a checkbox off and back on shouldn't
        // re-run the graph walk, but the counts must still follow real content.
        staleTime: STALE_TIME.Short
    });
}
