import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@orthacms/utils-admin';
import { httpWebhookGateway } from '../../infrastructure/httpWebhookGateway';
import { webhooksKeys } from '../../infrastructure/webhooksKeys';

/** How long the type catalogue is treated as fresh inside the editor. */
const OPTIONS_STALE_TIME_MS = 60_000;

/**
 * The code-defined content types, for the endpoint editor's type picker.
 *
 * Two things make this query unlike the others here.
 *
 * It reads content's registry (`GET /api/content-schema`), which is gated on
 * `content:read` rather than on a webhooks permission. Every administrator
 * holds it, so in practice it is there — but a deployment is free to define a
 * role that manages webhooks without reading content, and a **403 is answered
 * with an empty catalogue rather than an error**: the picker is a convenience
 * over a free-text filter, and typing a machine name still works with no
 * catalogue at all. Any other failure is a real failure and still throws.
 *
 * Like the other pickers it only exists inside a dialog, so the caller passes
 * `enabled` and nothing is fetched before the dialog opens.
 */
export function useContentTypeOptions(enabled = true) {
    return useQuery({
        queryKey: webhooksKeys.contentTypes(),
        queryFn: async () => {
            try {
                return await httpWebhookGateway.listContentTypeOptions();
            } catch (error) {
                if (error instanceof ApiError && error.status === 403) {
                    return [];
                }
                throw error;
            }
        },
        staleTime: OPTIONS_STALE_TIME_MS,
        enabled
    });
}
