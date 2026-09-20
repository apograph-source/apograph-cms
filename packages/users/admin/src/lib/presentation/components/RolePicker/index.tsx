import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Label,
    RadioGroup,
    RadioGroupItem,
    cn
} from '@orthacms/design-system';
import type { MemberRole } from '../../../domain/types/member';

/** Intl descriptors for {@link RolePicker}, co-located with the component. */
const messages = defineMessages({
    adminName: { id: 'users.rolePicker.adminName', defaultMessage: 'Admin' },
    adminDesc: {
        id: 'users.rolePicker.adminDesc',
        defaultMessage:
            'Full access: manage members, roles, workspaces, and content.'
    },
    contributorName: {
        id: 'users.rolePicker.contributorName',
        defaultMessage: 'Contributor'
    },
    contributorDesc: {
        id: 'users.rolePicker.contributorDesc',
        defaultMessage: 'Can read members and work within their workspaces.'
    },
    viewerName: { id: 'users.rolePicker.viewerName', defaultMessage: 'Viewer' },
    viewerDesc: {
        id: 'users.rolePicker.viewerDesc',
        defaultMessage: 'Read-only access to members and workspaces.'
    },
    current: { id: 'users.rolePicker.current', defaultMessage: 'Current' },
    group: { id: 'users.rolePicker.group', defaultMessage: 'Global role' }
});

const ROLES: ReadonlyArray<{
    key: MemberRole;
    name: (typeof messages)[keyof typeof messages];
    desc: (typeof messages)[keyof typeof messages];
}> = [
    { key: 'admin', name: messages.adminName, desc: messages.adminDesc },
    {
        key: 'contributor',
        name: messages.contributorName,
        desc: messages.contributorDesc
    },
    { key: 'viewer', name: messages.viewerName, desc: messages.viewerDesc }
];

/**
 * A radio-card selector over the three assignable system roles, with each
 * role's description and a "Current" badge on the saved one. Controlled: the
 * parent owns `value` and decides what "apply" does. Used by the detail page's
 * Role tab (and available to the invite flow).
 */
export function RolePicker({
    value,
    current,
    disabled = false,
    onChange
}: {
    /**
     * The selected role, or `null` for a member holding a custom role — no card
     * is then marked selected, rather than one being picked on their behalf.
     */
    value: MemberRole | null;
    /** The member's currently-saved role, badged as "Current". */
    current?: MemberRole | null;
    /** Disables selection (read-only / in-flight). */
    disabled?: boolean;
    /** Called with the newly-picked role. */
    onChange: (role: MemberRole) => void;
}) {
    const intl = useIntl();

    return (
        <RadioGroup
            value={value ?? undefined}
            onValueChange={(next) => onChange(next as MemberRole)}
            disabled={disabled}
            aria-label={intl.formatMessage(messages.group)}
            className="gap-3"
        >
            {ROLES.map((role) => {
                const id = `role-${role.key}`;
                const selected = value === role.key;
                return (
                    <Label
                        key={role.key}
                        htmlFor={id}
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                            selected
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50',
                            disabled && 'cursor-not-allowed opacity-70'
                        )}
                    >
                        <RadioGroupItem
                            id={id}
                            value={role.key}
                            className="mt-0.5"
                        />
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                    {intl.formatMessage(role.name)}
                                </span>
                                {current === role.key ? (
                                    <Badge
                                        variant="secondary"
                                        className="rounded-xl border-border"
                                    >
                                        {intl.formatMessage(messages.current)}
                                    </Badge>
                                ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {intl.formatMessage(role.desc)}
                            </p>
                        </div>
                    </Label>
                );
            })}
        </RadioGroup>
    );
}
