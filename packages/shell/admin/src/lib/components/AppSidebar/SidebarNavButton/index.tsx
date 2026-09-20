import { Link, useMatch } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { SidebarMenuButton, SidebarMenuItem } from '@orthacms/design-system';
import type { SidebarItem } from '../../../slots/sidebarSlots';

type SidebarNavButtonProps = {
    /** The nav item to render. */
    item: SidebarItem;
};

/**
 * One primary-nav row in the global sidebar: an icon + label link. Resolves the
 * translated label, derives active state from the current route, and hides
 * itself when the item is permission-gated and the user lacks the permission
 * (the UI mirror of the linked route's server-side gate).
 */
export function SidebarNavButton({ item }: SidebarNavButtonProps) {
    const intl = useIntl();
    const match = useMatch(item.end ? item.to : `${item.to}/*`);
    const isActive = Boolean(match);
    const Icon = item.icon;
    const label = intl.formatMessage({
        id: item.labelId,
        defaultMessage: item.defaultLabel
    });

    // Always call the hook (an empty key is never granted) so hook order stays
    // stable; an entry with no `permission` is visible to every signed-in user.
    const hasRequired = useHasPermission(item.permission ?? '');
    if (item.permission && !hasRequired) {
        return null;
    }

    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                <Link to={item.to} aria-current={isActive ? 'page' : undefined}>
                    <Icon className={isActive ? item.iconColor : undefined} />
                    <span>{label}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}
