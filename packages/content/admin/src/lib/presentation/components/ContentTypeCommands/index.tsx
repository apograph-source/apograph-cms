import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { CommandGroup, CommandItem } from '@orthacms/design-system';
import type { CommandSectionProps } from '@orthacms/shell-admin';
import { useWorkspaces } from '@orthacms/workspaces-admin';
import { useContentTypes } from '../../../application/useContentTypes';
import { CONTENT_READ, CONTENT_SEGMENT } from '../../../domain/constants';

/** Intl descriptors for {@link ContentTypeCommands}, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'content.command.heading',
        defaultMessage: 'Content types'
    }
});

/**
 * The command palette's Content types group: every workspace's granted content
 * types as results that open the type directly (`/workspaces/:id/content/:type`),
 * each labelled with its workspace. Contributed to the shell's `COMMAND_SLOT`
 * by `content-admin`, so ⌘K can jump straight into a collection or page from
 * anywhere. Hidden without `content:read`. The global type catalogue
 * (`GET /api/content-schema`) is scoped per workspace by its granted slugs.
 */
export function ContentTypeCommands({ close }: CommandSectionProps) {
    const intl = useIntl();
    const navigate = useNavigate();
    const canRead = useHasPermission(CONTENT_READ);
    const { data: workspaces } = useWorkspaces();
    const { data: types } = useContentTypes(canRead);

    if (!canRead || !workspaces || !types) {
        return null;
    }

    const entries = workspaces
        .filter((workspace) => workspace.status === 'Active')
        .flatMap((workspace) => {
            const granted = new Set(workspace.content);
            return types
                .filter((type) => granted.has(type.name))
                .map((type) => ({ workspace, type }));
        });
    if (entries.length === 0) {
        return null;
    }

    const go = (workspaceId: string, typeName: string) => {
        close();
        navigate(`/workspaces/${workspaceId}/${CONTENT_SEGMENT}/${typeName}`);
    };

    return (
        <CommandGroup heading={intl.formatMessage(messages.heading)}>
            {entries.map(({ workspace, type }) => (
                <CommandItem
                    key={`${workspace.id}:${type.name}`}
                    // Fold in the machine name + workspace so cmdk matches all.
                    value={`${type.label} ${type.name} ${workspace.name}`}
                    onSelect={() => go(workspace.id, type.name)}
                >
                    <span className="truncate">{type.label}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                        {workspace.name}
                    </span>
                </CommandItem>
            ))}
        </CommandGroup>
    );
}
