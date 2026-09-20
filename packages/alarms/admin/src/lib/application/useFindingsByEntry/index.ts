import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { alarmsKeys } from '../../infrastructure/alarmsKeys';
import { httpAlarmsGateway } from '../../infrastructure/httpAlarmsGateway';

/**
 * Live findings for a set of entries, keyed by entry id.
 *
 * One request for a whole records page — the batch the `RECORDS_COLUMN_SLOT`
 * hook and the editor's sidebar widget both read. `enabled` matters more here
 * than elsewhere: the records column is **hidden by default**, and its
 * `useRowsData` hook runs on every render whether or not the column is shown,
 * so without honouring `isVisible` this would fetch on every page of every
 * list for data nobody is looking at.
 */
export function useFindingsByEntry(
    entryIds: readonly string[],
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: alarmsKeys.byEntry(workspace.id, entryIds),
        queryFn: () => httpAlarmsGateway.findingsByEntry(entryIds),
        enabled: enabled && entryIds.length > 0
    });
}
