import { defineMessages, useIntl } from 'react-intl';
import { Badge, cn } from '@orthacms/design-system';
import type { WorkspaceStatus } from '../../../domain/types/workspace';

/** Intl descriptors for {@link StatusChip}, co-located with the component. */
const messages = defineMessages({
    active: {
        id: 'workspaces.status.active',
        defaultMessage: 'Active'
    },
    archived: {
        id: 'workspaces.status.archived',
        defaultMessage: 'Archived'
    }
});

/**
 * A small status pill with a leading dot: green for an active workspace, muted
 * for an archived one. Shown in the workspaces table's status column.
 */
export function StatusChip({ status }: { status: WorkspaceStatus }) {
    const intl = useIntl();
    const isActive = status === 'Active';

    return (
        <Badge
            variant={isActive ? 'success' : 'secondary'}
            className={cn('gap-1.5 rounded-xl', !isActive && 'border-border')}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 rounded-full',
                    isActive ? 'bg-status-active' : 'bg-muted-foreground'
                )}
            />
            <span className={cn(!isActive && 'text-muted-foreground')}>
                {intl.formatMessage(
                    isActive ? messages.active : messages.archived
                )}
            </span>
        </Badge>
    );
}
