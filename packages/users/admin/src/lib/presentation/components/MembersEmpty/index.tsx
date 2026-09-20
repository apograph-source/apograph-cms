import { defineMessages, useIntl } from 'react-intl';
import { UserPlus, Users } from 'lucide-react';
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link MembersEmpty}, co-located with the component. */
const messages = defineMessages({
    filteredTitle: {
        id: 'users.empty.filtered.title',
        defaultMessage: 'No members match'
    },
    filteredDescription: {
        id: 'users.empty.filtered.description',
        defaultMessage: 'Try a different name or email, or clear the search.'
    },
    clear: {
        id: 'users.empty.clear',
        defaultMessage: 'Clear search'
    },
    emptyTitle: {
        id: 'users.empty.none.title',
        defaultMessage: 'No members yet'
    },
    emptyDescription: {
        id: 'users.empty.none.description',
        defaultMessage: 'Invite the first member to give them access.'
    },
    invite: {
        id: 'users.empty.invite',
        defaultMessage: 'Invite member'
    }
});

type MembersEmptyProps = {
    /** Whether a search is currently narrowing the list. */
    filtered: boolean;
    /** Clears the search. */
    onClear: () => void;
    /** Opens the invite flow. Omitted when the user lacks `users:create`. */
    onInvite?: () => void;
};

/**
 * The empty state under the toolbar. A search miss offers to clear the
 * search; a genuinely empty roster invites the first member (when the
 * signed-in user may invite).
 */
export function MembersEmpty({
    filtered,
    onClear,
    onInvite
}: MembersEmptyProps) {
    const intl = useIntl();

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Users />
                </EmptyMedia>
                <EmptyTitle>
                    {intl.formatMessage(
                        filtered ? messages.filteredTitle : messages.emptyTitle
                    )}
                </EmptyTitle>
                <EmptyDescription>
                    {intl.formatMessage(
                        filtered
                            ? messages.filteredDescription
                            : messages.emptyDescription
                    )}
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                {filtered ? (
                    <Button
                        variant="outline"
                        className="shadow-none"
                        onClick={onClear}
                    >
                        {intl.formatMessage(messages.clear)}
                    </Button>
                ) : onInvite ? (
                    <Button onClick={onInvite}>
                        <UserPlus />
                        {intl.formatMessage(messages.invite)}
                    </Button>
                ) : null}
            </EmptyContent>
        </Empty>
    );
}
