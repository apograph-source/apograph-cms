import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { entryRelationsKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    entryRelationsKey,
    entryRelationsPrefix
} from '../../infrastructure/contentKeys';

/**
 * Reads an entry's assigned relations for the editor via the content gateway —
 * one request covering **all** relation fields (each field's first page + total).
 * The editor seeds each relation field's form value from the returned ids and
 * renders the links by title. Disabled until there's an id (create mode has none;
 * a single page resolves its id first). The cache key is workspace-scoped.
 */
export function useEntryRelations(
    name: string,
    id: string | undefined,
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: entryRelationsKey(workspace.id, name, id ?? ''),
        queryFn: () => httpContentGateway.getEntryRelations(name, id as string),
        enabled: enabled && !!id
    });
}
