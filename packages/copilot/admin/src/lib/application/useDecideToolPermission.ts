import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import type { ToolPermissionDecision } from '@orthacms/copilot-domain';

/** What the panel asks for. */
export interface DecideToolPermissionInput {
    runId: string;
    callId: string;
    decision: ToolPermissionDecision;
    workspaceId: string;
}

/**
 * Answers a parked run.
 *
 * **A second request against a run that is still streaming.** The run is an SSE
 * response and cannot be replied to, so the decision travels as its own POST
 * addressed by the `runId` the `run-started` frame carried.
 *
 * A **404 is expected traffic**, not a bug: nothing was waiting because the
 * run's five-minute timeout had already fired, or it is parked on another
 * instance (the broker holds its promises in memory). The prompt keeps its
 * buttons and says the answer did not land, rather than pretending it did —
 * telling the user their click did nothing is the only honest option, since the
 * run will have carried on without it.
 */
export function useDecideToolPermission() {
    return useMutation({
        mutationFn: async ({
            runId,
            callId,
            decision,
            workspaceId
        }: DecideToolPermissionInput) => {
            await apiClient.post(
                `/copilot/runs/${runId}/permission`,
                { callId, decision },
                { headers: { 'X-Workspace-Id': workspaceId } }
            );
        }
    });
}
