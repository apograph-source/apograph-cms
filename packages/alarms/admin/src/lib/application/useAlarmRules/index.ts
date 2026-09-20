import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { alarmsKeys } from '../../infrastructure/alarmsKeys';
import { httpAlarmsGateway } from '../../infrastructure/httpAlarmsGateway';

/**
 * Every rule in the open workspace, with its live open-finding count.
 *
 * Disabled until the caller confirms `alarms:read`, so a member without it
 * never fires a request the server would 403.
 */
export function useAlarmRules(enabled = true) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: alarmsKeys.rules(workspace.id),
        queryFn: () => httpAlarmsGateway.listRules(),
        enabled
    });
}
