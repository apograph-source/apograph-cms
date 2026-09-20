import { useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { CommandItem } from '@orthacms/design-system';
import type { SidebarItem } from '../../../../slots/sidebarSlots';

type SidebarCommandItemProps = {
    /** The nav destination this result represents. */
    item: SidebarItem;
    /** Invoked with the item's path when the result is chosen. */
    onNavigate: (to: string) => void;
};

/**
 * One "Go to" result in the {@link SidebarSearch} palette: an icon + label that
 * navigates to a primary-nav destination. Hidden when the destination is
 * permission-gated and the user lacks it — the palette mirrors the sidebar, so
 * you can only jump to what you could click.
 */
export function SidebarCommandItem({
    item,
    onNavigate
}: SidebarCommandItemProps) {
    const intl = useIntl();
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

    const Icon = item.icon;
    return (
        <CommandItem value={label} onSelect={() => onNavigate(item.to)}>
            <Icon />
            <span>{label}</span>
        </CommandItem>
    );
}
