import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { alarmsKeys } from '../../infrastructure/alarmsKeys';
import { httpAlarmsGateway } from '../../infrastructure/httpAlarmsGateway';

/** Open finding counts for the workspace — the nav badge's numbers. */
export function useAlarmSummary(enabled = true) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: alarmsKeys.summary(workspace.id),
        queryFn: () => httpAlarmsGateway.summary(),
        enabled
    });
}
