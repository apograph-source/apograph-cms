import { defineMessages, useIntl } from 'react-intl';
import { Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Spinner } from '@orthacms/design-system';
import { MemberAvatar } from '../MemberAvatar';
import type { MemberWorkspace } from '../../../domain/types/member';

/** Intl descriptors for {@link WorkspaceMembershipCard}. */
const messages = defineMessages({
    remove: {
        id: 'users.workspaces.remove',
        defaultMessage: 'Remove'
    },
    removeLabel: {
        id: 'users.workspaces.removeLabel',
        defaultMessage: 'Remove from {name}'
    }
});

/**
 * One workspace the member belongs to: its tinted mark, name, and (when the
 * viewer can manage members) a Remove action. Removal is confirmed by the
 * parent page, so this card just signals intent.
 */
export function WorkspaceMembershipCard({
    workspace,
    onRemove,
    removing = false
}: {
    /** The workspace membership to render. */
    workspace: MemberWorkspace;
    /** Remove handler; omit to hide the action (read-only). */
    onRemove?: (workspace: MemberWorkspace) => void;
    /** Whether a removal for this workspace is in flight. */
    removing?: boolean;
}) {
    const intl = useIntl();

    return (
        <Card>
            <CardContent className="flex items-center gap-3 pt-6">
                <MemberAvatar
                    initials={workspace.initials}
                    color={workspace.color}
                    className="size-9 shrink-0 text-xs"
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                        {workspace.name}
                    </p>
                    {workspace.description ? (
                        <p className="line-clamp-3 text-xs text-muted-foreground">
                            {workspace.description}
                        </p>
                    ) : null}
                </div>
                {onRemove ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled={removing}
                        aria-label={intl.formatMessage(messages.removeLabel, {
                            name: workspace.name
                        })}
                        onClick={() => onRemove(workspace)}
                    >
                        {removing ? (
                            <Spinner />
                        ) : (
                            <Trash2 aria-hidden className="size-4" />
                        )}
                        {intl.formatMessage(messages.remove)}
                    </Button>
                ) : null}
            </CardContent>
        </Card>
    );
}
