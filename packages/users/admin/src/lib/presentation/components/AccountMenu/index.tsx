import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem
} from '@orthacms/design-system';
import { avatarColorForId, initialsOf } from '@orthacms/utils-admin';
import {
    AuthStatus,
    useAuth,
    useLogoutMutation
} from '@orthacms/identity-admin';
import { MemberAvatar } from '../MemberAvatar';

/** Intl descriptors for {@link AccountMenu}, co-located with the component. */
const messages = defineMessages({
    open: {
        id: 'users.account.open',
        defaultMessage: 'Account menu'
    },
    myProfile: {
        id: 'users.account.myProfile',
        defaultMessage: 'My profile'
    },
    logout: {
        id: 'users.account.logout',
        defaultMessage: 'Logout'
    }
});

/**
 * The account widget pinned to the sidebar footer: a full-width row showing the
 * signed-in user's avatar, name, and email that opens a menu with a link to
 * their own profile (the user detail page) and a Logout action. Contributed to
 * the shell's `SIDEBAR_FOOTER_SLOT`. Renders nothing until a user is resolved,
 * so it never flashes an empty row during the auth probe.
 */
export function AccountMenu() {
    const intl = useIntl();
    const navigate = useNavigate();
    const auth = useAuth();
    const logout = useLogoutMutation();

    if (auth.status !== AuthStatus.Authenticated) {
        return null;
    }

    const { id, email, name } = auth.user;
    const displayName = name ?? email;

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            aria-label={intl.formatMessage(messages.open)}
                        >
                            <MemberAvatar
                                initials={initialsOf(displayName)}
                                color={avatarColorForId(id)}
                                className="size-8 text-xs"
                            />
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                                <span className="truncate text-sm font-medium">
                                    {displayName}
                                </span>
                                <span className="truncate text-xs text-sidebar-foreground/70">
                                    {email}
                                </span>
                            </span>
                            <ChevronsUpDown className="ml-auto" aria-hidden />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        side="top"
                        align="start"
                        className="w-56"
                    >
                        <DropdownMenuItem
                            onSelect={() => navigate(`/users/${id}`)}
                        >
                            <UserRound aria-hidden />
                            {intl.formatMessage(messages.myProfile)}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={logout.isPending}
                            onSelect={() => logout.mutate()}
                        >
                            <LogOut aria-hidden />
                            {intl.formatMessage(messages.logout)}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
