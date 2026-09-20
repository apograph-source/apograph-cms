import { defineMessages, useIntl } from 'react-intl';
import { useAuth } from '@orthacms/identity-admin';
import { Avatar, AvatarFallback, Separator } from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import type { MemberDraft } from '../../../../domain/types/wizard';
import { MemberRow } from './MemberRow';
import { MemberTypeahead } from './MemberTypeahead';

const messages = defineMessages({
    listLabel: {
        id: 'workspaces.create.members.listLabel',
        defaultMessage: 'People with access'
    },
    you: {
        id: 'workspaces.create.members.you',
        defaultMessage: 'You'
    },
    empty: {
        id: 'workspaces.create.members.empty',
        defaultMessage:
            "It's just you for now. Add teammates above, or skip and invite them later."
    }
});

/** Props for {@link MembersStep}. */
export type MembersStepProps = {
    /** Added members (excludes the owner). */
    members: MemberDraft[];
    /** Add a member. */
    addMember: (member: MemberDraft) => void;
    /** Remove a member by id. */
    removeMember: (id: string) => void;
};

/**
 * The members step body: the directory typeahead plus the "People with access"
 * list — the current user pinned and locked as owner, followed by each added
 * member with a role control and a remove button.
 */
export function MembersStep({
    members,
    addMember,
    removeMember
}: MembersStepProps) {
    const intl = useIntl();
    const auth = useAuth();
    const user = 'user' in auth ? auth.user : undefined;

    const ownerName =
        user?.name ?? user?.email ?? intl.formatMessage(messages.you);
    const ownerId = user?.id ?? 'me';
    const excludeIds = new Set<string>([ownerId, ...members.map((m) => m.id)]);

    return (
        <div className="flex flex-col gap-5">
            <MemberTypeahead excludeIds={excludeIds} onAdd={addMember} />

            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                    {intl.formatMessage(messages.listLabel)}
                </span>

                <div className="rounded-xl border">
                    <div className="flex items-center gap-3 px-3 py-2">
                        <Avatar className="size-9">
                            <AvatarFallback>
                                <span className="text-xs font-medium">
                                    {initialsOf(ownerName) || '—'}
                                </span>
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">
                                {ownerName}
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    ({intl.formatMessage(messages.you)})
                                </span>
                            </span>
                            {user?.email ? (
                                <span className="truncate text-xs text-muted-foreground">
                                    {user.email}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    {members.length > 0 ? (
                        <div className="flex flex-col px-3 pb-1">
                            {members.map((member) => (
                                <div key={member.id}>
                                    <Separator />
                                    <MemberRow
                                        member={member}
                                        onRemove={() => removeMember(member.id)}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            <Separator />
                            <p className="px-3 py-3 text-sm text-muted-foreground">
                                {intl.formatMessage(messages.empty)}
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
