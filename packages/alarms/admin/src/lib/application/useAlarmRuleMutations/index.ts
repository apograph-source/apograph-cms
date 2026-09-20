import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { alarmsKeys } from '../../infrastructure/alarmsKeys';
import { httpAlarmsGateway } from '../../infrastructure/httpAlarmsGateway';
import type {
    CreateAlarmRuleInput,
    UpdateAlarmRuleInput
} from '../../infrastructure/alarmsGateway';

/**
 * Creates a rule.
 *
 * The server scans the collection before it answers, so the response carries
 * both the rule and what the first scan found — which is what lets the UI say
 * "created, 14 findings opened" instead of "created" and leaving the editor to
 * go and look.
 *
 * Invalidates the workspace's whole alarms root rather than placing the new
 * rule: that one scan has just changed the findings list, the counts on every
 * other rule's card (a shared entry can match several), and the summary badge.
 * There is no useful subset to place.
 */
export function useCreateAlarmRule() {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    return useMutation({
        mutationFn: (input: CreateAlarmRuleInput) =>
            httpAlarmsGateway.createRule(input),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: alarmsKeys.all(workspace.id)
            });
        }
    });
}

/**
 * Applies a partial update to a rule.
 *
 * A changed filter triggers a server-side rescan before the response, so the
 * same blanket invalidation applies for the same reason. A rename does not need
 * it, but distinguishing the two here would mean the client deciding whether
 * the server rescanned — a fact only the server knows.
 */
export function useUpdateAlarmRule() {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    return useMutation({
        mutationFn: ({
            id,
            input
        }: {
            id: string;
            input: UpdateAlarmRuleInput;
        }) => httpAlarmsGateway.updateRule(id, input),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: alarmsKeys.all(workspace.id)
            });
        }
    });
}

/** Deletes a rule; its findings cascade away with it server-side. */
export function useDeleteAlarmRule() {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    return useMutation({
        mutationFn: (id: string) => httpAlarmsGateway.deleteRule(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: alarmsKeys.all(workspace.id)
            });
        }
    });
}

/** Re-runs one rule over its collection and reports what changed. */
export function useRescanAlarmRule() {
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    return useMutation({
        mutationFn: (id: string) => httpAlarmsGateway.rescanRule(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: alarmsKeys.all(workspace.id)
            });
        }
    });
}

/**
 * Runs a candidate filter without saving it.
 *
 * A mutation rather than a query even though it reads nothing: it is triggered
 * by the editor pressing a button, not by a component mounting, and modelling
 * it as a query would mean a key built from a filter tree that changes on every
 * keystroke.
 */
export function usePreviewAlarmRule() {
    return useMutation({
        mutationFn: ({
            contentType,
            filter
        }: {
            contentType: string;
            filter: Record<string, unknown>;
        }) => httpAlarmsGateway.previewRule(contentType, filter)
    });
}
