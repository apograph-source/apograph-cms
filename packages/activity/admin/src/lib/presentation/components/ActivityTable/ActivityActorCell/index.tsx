import { defineMessages, useIntl } from 'react-intl';
import {
    Avatar,
    AvatarFallback,
    avatarColorVar,
    cn
} from '@orthacms/design-system';
import { avatarColorForId, initialsFromEmail } from '@orthacms/utils-admin';
import type { ActivityActor } from '../../../../types/activityEvent';

/** Intl descriptors for {@link ActivityActorCell}, co-located. */
const messages = defineMessages({
    system: {
        id: 'activity.actor.system',
        defaultMessage: 'System'
    },
    unknown: {
        id: 'activity.actor.unknown',
        defaultMessage: 'Unknown'
    }
});

/**
 * The "Actor" cell: an initials avatar plus the actor's email. A `null` actor
 * (system-initiated event) renders a neutral "System" label with no avatar.
 * The avatar is decorative (`aria-hidden`) — the email beside it carries the
 * meaning.
 */
export function ActivityActorCell({ actor }: { actor: ActivityActor }) {
    const intl = useIntl();

    if (!actor) {
        return (
            <span className="text-sm text-muted-foreground">
                {intl.formatMessage(messages.system)}
            </span>
        );
    }

    const label = actor.email ?? intl.formatMessage(messages.unknown);

    return (
        <div className="flex items-center gap-3">
            <Avatar
                aria-hidden
                className={cn('size-8 shrink-0 text-xs')}
                style={{
                    backgroundColor: avatarColorVar(avatarColorForId(actor.id))
                }}
            >
                <AvatarFallback className="rounded-[inherit] bg-transparent font-semibold text-white">
                    {actor.email ? initialsFromEmail(actor.email) : '?'}
                </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{label}</span>
        </div>
    );
}
