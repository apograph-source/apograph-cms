import { Navigate, useParams } from 'react-router-dom';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { ContentType } from '../../../domain/types/contentType';
import {
    CONTENT_SEGMENT,
    ENTRY_PARAM,
    TYPE_PARAM
} from '../../../domain/constants';
import { ContentEntryView, type EntryMode } from '../ContentEntryView';

/**
 * Route adapter for the create (`:typeName/new`) and edit
 * (`:typeName/:entryId`) entry routes: resolves the `:typeName` param against
 * the workspace's granted types and renders {@link ContentEntryView}. An
 * unknown/ungranted type redirects to the Content Library index (mirroring the
 * page's catch-all), so a deep link can't strand the user on a blank form.
 */
export function ContentEntryRoute({
    types,
    mode
}: {
    types: ContentType[];
    mode: EntryMode;
}) {
    const params = useParams();
    const workspace = useCurrentWorkspace();
    const type = types.find(
        (candidate) => candidate.name === params[TYPE_PARAM]
    );

    if (!type) {
        return (
            <Navigate
                to={`/workspaces/${workspace.id}/${CONTENT_SEGMENT}`}
                replace
            />
        );
    }

    return (
        <ContentEntryView
            type={type}
            mode={mode}
            entryId={params[ENTRY_PARAM]}
        />
    );
}
