import { defineMessages, useIntl } from 'react-intl';
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@orthacms/design-system';
import { MemberAvatar } from '../../MemberAvatar';
import type { MemberWorkspace } from '../../../../domain/types/member';

/** Intl descriptors for {@link MemberWorkspaces}, co-located with the component. */
const messages = defineMessages({
    count: {
        id: 'users.workspaces.count',
        defaultMessage:
            '{count, plural, one {# workspace} other {# workspaces}}'
    },
    open: {
        id: 'users.workspaces.open',
        defaultMessage: 'View workspaces'
    },
    none: {
        id: 'users.workspaces.none',
        defaultMessage: 'No workspaces'
    }
});

/** Up to this many workspace avatars show before collapsing into a "+N" pill. */
const MAX_AVATARS = 3;

/**
 * The Workspaces column: a row of overlapping workspace avatars plus a count,
 * opening a popover that lists every workspace the member belongs to — the
 * same stack-and-popover treatment as the workspace card's member roster.
 */
export function MemberWorkspaces({
    workspaces
}: {
    workspaces: MemberWorkspace[];
}) {
    const intl = useIntl();

    if (workspaces.length === 0) {
        return (
            <span className="text-sm text-muted-foreground">
                {intl.formatMessage(messages.none)}
            </span>
        );
    }

    const shown = workspaces.slice(0, MAX_AVATARS);
    const overflow = workspaces.length - shown.length;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={intl.formatMessage(messages.open)}
                    onClick={(event) => event.stopPropagation()}
                    className="-m-1 flex items-center gap-2 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <span className="flex">
                        {shown.map((workspace, index) => (
                            <MemberAvatar
                                key={workspace.id}
                                initials={workspace.initials}
                                color={workspace.color}
                                className="size-[26px] border-2 border-background text-[10px]"
                                style={{ marginLeft: index === 0 ? 0 : -8 }}
                            />
                        ))}
                        {overflow > 0 ? (
                            <span
                                className="flex size-[26px] items-center justify-center rounded-xl border-2 border-background bg-secondary text-[10px] font-semibold text-muted-foreground"
                                style={{ marginLeft: -8 }}
                            >
                                +{overflow}
                            </span>
                        ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.count, {
                            count: workspaces.length
                        })}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
                <ul className="max-h-[15rem] overflow-y-auto py-1">
                    {workspaces.map((workspace) => (
                        <li
                            key={workspace.id}
                            className="flex items-center gap-3 px-4 py-2"
                        >
                            <MemberAvatar
                                initials={workspace.initials}
                                color={workspace.color}
                                className="size-[26px] shrink-0 text-[10px]"
                            />
                            <span className="truncate text-sm">
                                {workspace.name}
                            </span>
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
