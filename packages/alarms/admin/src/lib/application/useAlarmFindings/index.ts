import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import {
    alarmsKeys,
    type FindingsListParams
} from '../../infrastructure/alarmsKeys';
import { httpAlarmsGateway } from '../../infrastructure/httpAlarmsGateway';

/**
 * One page of the workspace's findings.
 *
 * `keepPreviousData` so paging or switching the state tab does not blank the
 * list between renders — the counts above it stay put and the page does not
 * jump.
 */
export function useAlarmFindings(params: FindingsListParams, enabled = true) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: alarmsKeys.findings(workspace.id, params),
        queryFn: () => httpAlarmsGateway.listFindings(params),
        placeholderData: keepPreviousData,
        enabled
    });
}
