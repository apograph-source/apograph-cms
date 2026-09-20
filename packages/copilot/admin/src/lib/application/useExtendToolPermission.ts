import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';

/** What the prompt asks for when the user needs longer. */
export interface ExtendToolPermissionInput {
    runId: string;
    callId: string;
    workspaceId: string;
}

/** What the server grants back. */
export interface ExtendToolPermissionResult {
    /** The new deadline, as an ISO instant. */
    expiresAt: string;
}

/**
 * Asks for more time to answer a parked run.
 *
 * The prompt used to carry a five-minute limit with no warning, no countdown and
 * nothing to press: it simply disappeared and the model reported that nobody had
 * answered. WCAG 2.2.1 requires that a content-set time limit can be turned off,
 * adjusted, or extended after a warning — and none of its exceptions apply,
 * because ADR-0009 justifies the limit as *cost*, not correctness (`ORT-118`).
 *
 * A **404 is expected traffic**, exactly as it is for a decision: nothing was
 * waiting because the deadline had already passed, or the run is parked on
 * another instance. The prompt says the extension did not land rather than
 * showing a countdown the server does not agree with.
 */
export function useExtendToolPermission() {
    return useMutation({
        mutationFn: async ({
            runId,
            callId,
            workspaceId
        }: ExtendToolPermissionInput): Promise<ExtendToolPermissionResult> => {
            const { data } = await apiClient.post<ExtendToolPermissionResult>(
                `/copilot/runs/${runId}/permission/extend`,
                { callId },
                { headers: { 'X-Workspace-Id': workspaceId } }
            );
            return data;
        }
    });
}
