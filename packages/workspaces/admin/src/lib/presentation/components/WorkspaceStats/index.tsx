import { defineMessages, useIntl } from 'react-intl';
import { FileStack, Layers, Users } from 'lucide-react';
import { StatTile } from '@orthacms/design-system';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { isActiveWorkspace } from '../../../domain/isActiveWorkspace';

/** Intl descriptors for {@link WorkspaceStats}, co-located here. */
const messages = defineMessages({
    activeWorkspaces: {
        id: 'workspaces.stats.active',
        defaultMessage: 'Active workspaces'
    },
    members: {
        id: 'workspaces.stats.members',
        defaultMessage: 'Members'
    },
    contentTypes: {
        id: 'workspaces.stats.contentTypes',
        defaultMessage: 'Content types'
    },
    error: {
        id: 'workspaces.stats.error',
        defaultMessage: 'Couldn’t load workspace stats.'
    }
});

/** A placeholder shown for a metric while the list query is in flight. */
const LOADING = '—';

/**
 * The home dashboard's workspace stat tiles: active-workspace count, the number
 * of distinct members across all workspaces, and the number of distinct content
 * types granted — all derived from the real `GET /api/workspaces` payload (no
 * separate metrics API yet). Rendered as a `display: contents` group so the
 * three tiles flow directly into the home page's stat grid.
 */
export function WorkspaceStats() {
    const intl = useIntl();
    const { data: workspaces, isPending, isError } = useWorkspaces();

    // A failed load must not read as real zeros — surface it distinctly so the
    // operator doesn't mistake "couldn't load" for "nothing here".
    if (isError) {
        return (
            <p
                role="alert"
                className="col-span-full rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
                {intl.formatMessage(messages.error)}
            </p>
        );
    }

    const active = workspaces?.filter(isActiveWorkspace).length ?? 0;
    const members = new Set(
        (workspaces ?? []).flatMap((w) => w.members.map((m) => m.id))
    ).size;
    const contentTypes = new Set((workspaces ?? []).flatMap((w) => w.content))
        .size;

    return (
        <div className="contents">
            <StatTile
                value={isPending ? LOADING : active}
                label={intl.formatMessage(messages.activeWorkspaces)}
                icon={Layers}
            />
            <StatTile
                value={isPending ? LOADING : members}
                label={intl.formatMessage(messages.members)}
                icon={Users}
            />
            <StatTile
                value={isPending ? LOADING : contentTypes}
                label={intl.formatMessage(messages.contentTypes)}
                icon={FileStack}
            />
        </div>
    );
}
