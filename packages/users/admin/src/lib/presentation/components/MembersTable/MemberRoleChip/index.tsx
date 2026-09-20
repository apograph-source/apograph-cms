import { defineMessages, useIntl } from 'react-intl';
import { Badge } from '@orthacms/design-system';
import type { MemberRole } from '../../../../domain/types/member';

/** Intl descriptors for {@link MemberRoleChip}, co-located with the component. */
const messages = defineMessages({
    admin: {
        id: 'users.role.admin',
        defaultMessage: 'Admin'
    },
    contributor: {
        id: 'users.role.contributor',
        defaultMessage: 'Contributor'
    },
    viewer: {
        id: 'users.role.viewer',
        defaultMessage: 'Viewer'
    }
});

const ROLE_MESSAGE: Record<
    MemberRole,
    (typeof messages)[keyof typeof messages]
> = {
    admin: messages.admin,
    contributor: messages.contributor,
    viewer: messages.viewer
};

/**
 * The Role column's read-only chip: the member's role as a labelled badge.
 * Changing a role happens through the row's edit action (and the server gates
 * it on `users:update`), so the column itself carries no inline editor.
 *
 * A member holding a **custom** role has `role: null`; the chip then shows the
 * server's own `roleName` rather than a guessed system role, so the column never
 * misstates someone's privileges.
 */
export function MemberRoleChip({
    role,
    roleName
}: {
    /** The member's system role, or `null` for a custom one. */
    role: MemberRole | null;
    /** The server's label, shown verbatim when `role` is `null`. */
    roleName: string;
}) {
    const intl = useIntl();

    return (
        <Badge
            variant={role === 'admin' ? 'primary-soft' : 'secondary'}
            className="rounded-xl"
        >
            {role === null ? roleName : intl.formatMessage(ROLE_MESSAGE[role])}
        </Badge>
    );
}
