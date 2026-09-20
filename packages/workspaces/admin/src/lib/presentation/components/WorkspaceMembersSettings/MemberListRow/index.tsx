import { defineMessages, useIntl } from 'react-intl';
import { X } from 'lucide-react';
import { Button } from '@orthacms/design-system';
import type { WorkspaceMember } from '../../../../domain/types/workspace';
import { WorkspaceAvatar } from '../../WorkspaceAvatar';

const messages = defineMessages({
    remove: {
        id: 'workspaces.settings.members.remove',
        defaultMessage: 'Remove {name}'
    }
});

/** Props for {@link MemberListRow}. */
export type MemberListRowProps = {
    /** The member to render. */
    member: WorkspaceMember;
    /** Whether a remove control should be offered. */
    canRemove: boolean;
    /** Called when the remove control is pressed. */
    onRemove: () => void;
};

/**
 * One row in the members roster: avatar, name, email, and — when the current
 * user may manage members — a remove button. Access is permission-based, so no
 * member is special.
 */
export function MemberListRow({
    member,
    canRemove,
    onRemove
}: MemberListRowProps) {
    const intl = useIntl();

    return (
        <div className="flex items-center gap-3 px-3 py-2">
            <WorkspaceAvatar
                className="size-9 text-xs"
                initials={member.initials || '—'}
                color={member.color}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                    {member.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                    {member.email}
                </span>
            </div>
            {canRemove ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    // Marks this as the roster's focus target: removing a member
                    // destroys the button focus would otherwise return to, so
                    // the list finds the next one by this attribute.
                    data-remove-member=""
                    // …and identifies *which* row, so a dismissed dialog can
                    // hand focus back to the one that opened it.
                    data-member-id={member.id}
                    onClick={onRemove}
                    aria-label={intl.formatMessage(messages.remove, {
                        name: member.name
                    })}
                >
                    <X className="size-4" />
                </Button>
            ) : null}
        </div>
    );
}
