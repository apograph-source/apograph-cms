import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import type { TransferDepth, TransferFormat } from '@orthacms/transfer-domain';

/** One export request. */
export interface ExportRequest {
    typeName: string;
    ids: readonly string[];
    format: TransferFormat;
    depth: TransferDepth;
}

/** What the download turned out to be. */
export interface ExportOutcome {
    filename: string;
    /** Records the server says it wrote, from `X-Transfer-Records`. */
    records: number;
}

/** Pulls the filename out of a `Content-Disposition`, falling back sensibly. */
function filenameOf(disposition: unknown, fallback: string): string {
    if (typeof disposition !== 'string') return fallback;
    const quoted = /filename="([^"]+)"/.exec(disposition);
    return quoted?.[1] ?? fallback;
}

/**
 * Requests the export and hands the browser the file.
 *
 * The download is driven from a blob rather than by navigating to the URL,
 * because the route is a `POST` carrying the selection and the depth options —
 * there is no URL to navigate to. The object URL is revoked as soon as the
 * click is dispatched; leaving it alive holds the whole file in memory for the
 * life of the tab, which for a media export is exactly the memory you do not
 * want to keep.
 */
export function useExportDownload() {
    return useMutation<ExportOutcome, unknown, ExportRequest>({
        mutationFn: async ({ typeName, ids, format, depth }) => {
            const response = await apiClient.post(
                `/content/${typeName}/export`,
                { ids, format, depth },
                { responseType: 'blob' }
            );
            const filename = filenameOf(
                response.headers['content-disposition'],
                `${typeName}.${format}`
            );
            const url = URL.createObjectURL(response.data as Blob);
            try {
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = filename;
                anchor.rel = 'noopener';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
            } finally {
                URL.revokeObjectURL(url);
            }
            const header = response.headers['x-transfer-records'];
            return {
                filename,
                records: Number(header) || 0
            };
        }
    });
}
