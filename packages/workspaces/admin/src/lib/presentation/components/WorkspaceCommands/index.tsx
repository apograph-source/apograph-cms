import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { CommandGroup, CommandItem } from '@orthacms/design-system';
import type { CommandSectionProps } from '@orthacms/shell-admin';
import { initialsOf } from '@orthacms/utils-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { isActiveWorkspace } from '../../../domain/isActiveWorkspace';
import { WorkspaceAvatar } from '../WorkspaceAvatar';

/** Intl descriptors for {@link WorkspaceCommands}, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'workspaces.command.heading',
        defaultMessage: 'Workspaces'
    }
});

/**
 * The command palette's Workspaces group: every active workspace as a result
 * that jumps into it. Contributed to the shell's `COMMAND_SLOT` by
 * `workspaces-admin`, so a member can open a workspace from anywhere via ⌘K.
 */
export function WorkspaceCommands({ close }: CommandSectionProps) {
    const intl = useIntl();
    const navigate = useNavigate();
    const { data: workspaces } = useWorkspaces();

    const active = (workspaces ?? []).filter(isActiveWorkspace);
    if (active.length === 0) {
        return null;
    }

    const go = (id: string) => {
        close();
        navigate(`/workspaces/${id}`);
    };

    return (
        <CommandGroup heading={intl.formatMessage(messages.heading)}>
            {active.map((workspace) => (
                <CommandItem
                    key={workspace.id}
                    value={`${workspace.name} workspace`}
                    onSelect={() => go(workspace.id)}
                >
                    <span aria-hidden>
                        <WorkspaceAvatar
                            initials={initialsOf(workspace.name)}
                            color={workspace.color}
                            className="size-5 rounded-[5px] text-[10px]"
                        />
                    </span>
                    <span>{workspace.name}</span>
                </CommandItem>
            ))}
        </CommandGroup>
    );
}
