import { defineMessages, useIntl } from 'react-intl';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { Avatar, AvatarFallback } from '@orthacms/design-system';

const messages = defineMessages({
    unknown: {
        id: 'protection.reviewer.unknown',
        defaultMessage: 'A former member'
    },
    you: { id: 'protection.reviewer.you', defaultMessage: 'You' }
});

/**
 * One reviewer's name and initials, resolved from the open workspace.
 *
 * The API stays id-only, and this is where the id becomes a person. It reads
 * the workspace the shell already resolved — `useCurrentWorkspace` carries its
 * members — so putting a name beside a vote costs **no request**: the list is
 * in the cache before the editor mounts.
 *
 * Somebody who has left the workspace is named as such rather than given a
 * fabricated label. A vote is a record of who looked; inventing a name over a
 * gap in the roster would misreport the one fact the row exists to carry.
 */
export function ReviewerLabel({
    userId,
    currentUserId
}: {
    /** The reviewer, as the API reports them. */
    userId: string;
    /** The signed-in person, so their own vote reads "You". */
    currentUserId?: string;
}) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const member = workspace?.members.find((entry) => entry.id === userId);

    const name = member
        ? userId === currentUserId
            ? intl.formatMessage(messages.you)
            : member.name
        : intl.formatMessage(messages.unknown);

    return (
        <span className="flex min-w-0 items-center gap-2">
            <Avatar className="size-6 shrink-0">
                <AvatarFallback className="text-[0.625rem]">
                    {member?.initials ?? '—'}
                </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{name}</span>
        </span>
    );
}
