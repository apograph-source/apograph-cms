import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { entryMediaKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    entryMediaKey,
    entryMediaPrefix
} from '../../infrastructure/contentKeys';

/**
 * Reads an entry's media fields resolved to display refs (name / thumbnail url /
 * kind) for the editor's Media tab — one request covering **all** media fields.
 * Lets the tab label pre-existing assets and flag deleted ones without a per-id
 * round-trip. Disabled until there's an id (create mode has none). The cache key
 * is workspace-scoped; a save invalidates it so the tab reflects the new set.
 */
export function useEntryMedia(
    name: string,
    id: string | undefined,
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: entryMediaKey(workspace.id, name, id ?? ''),
        queryFn: () => httpContentGateway.getEntryMedia(name, id as string),
        enabled: enabled && !!id
    });
}
