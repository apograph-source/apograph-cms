import { Link, useMatch, useParams } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { SidebarMenuButton, SidebarMenuItem } from '@orthacms/design-system';
import type { WorkspaceNavItem } from '../../../slots/workspaceSlots';

type WorkspaceNavButtonProps = {
    /** The workspace nav entry to render. */
    item: WorkspaceNavItem;
};

/**
 * One row in the workspace sidebar's "Workspace" section: an icon + label link.
 * The item's `to` is relative to the workspace, so this resolves it against the
 * active `:id`, derives active state from the current route, and hides itself
 * when the item is permission-gated and the user lacks the permission.
 */
export function WorkspaceNavButton({ item }: WorkspaceNavButtonProps) {
    const intl = useIntl();
    const { id } = useParams();
    const to = `/workspaces/${id}/${item.to}`;
    const match = useMatch(`${to}/*`);
    const isActive = Boolean(match);
    const Icon = item.icon;
    const label = intl.formatMessage({
        id: item.labelId,
        defaultMessage: item.defaultLabel
    });

    // Always call the hook (an empty key is never granted) so hook order stays
    // stable; an entry with no `permission` is visible to every member.
    const hasRequired = useHasPermission(item.permission ?? '');
    if (item.permission && !hasRequired) {
        return null;
    }

    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                <Link to={to} aria-current={isActive ? 'page' : undefined}>
                    <Icon className={isActive ? item.iconColor : undefined} />
                    <span>{label}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}
