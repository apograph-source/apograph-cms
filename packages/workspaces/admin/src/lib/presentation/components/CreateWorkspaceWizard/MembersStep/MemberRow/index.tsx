import { defineMessages, useIntl } from 'react-intl';
import { Mail, X } from 'lucide-react';
import { Avatar, AvatarFallback, Badge, Button } from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import type { MemberDraft } from '../../../../../domain/types/wizard';

const messages = defineMessages({
    invited: {
        id: 'workspaces.create.members.invitedBadge',
        defaultMessage: 'Invited'
    },
    remove: {
        id: 'workspaces.create.members.remove',
        defaultMessage: 'Remove {name}'
    }
});

/** Props for {@link MemberRow}. */
export type MemberRowProps = {
    /** The added member. */
    member: MemberDraft;
    /** Remove the member from the list. */
    onRemove: () => void;
};

/**
 * One added member: avatar, name/email, an "Invited" badge for invite-by-email
 * rows, and a remove button.
 */
export function MemberRow({ member, onRemove }: MemberRowProps) {
    const intl = useIntl();

    return (
        <div className="flex items-center gap-3 py-2">
            <Avatar className="size-9">
                <AvatarFallback>
                    {member.invited ? (
                        <Mail className="size-4 text-muted-foreground" />
                    ) : (
                        <span className="text-xs font-medium">
                            {initialsOf(member.name) || '—'}
                        </span>
                    )}
                </AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                    {member.invited ? member.email : member.name}
                </span>
                {!member.invited ? (
                    <span className="truncate text-xs text-muted-foreground">
                        {member.email}
                    </span>
                ) : null}
            </div>

            {member.invited ? (
                <Badge variant="secondary">
                    {intl.formatMessage(messages.invited)}
                </Badge>
            ) : null}

            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                aria-label={intl.formatMessage(messages.remove, {
                    name: member.invited ? member.email : member.name
                })}
            >
                <X />
            </Button>
        </div>
    );
}
