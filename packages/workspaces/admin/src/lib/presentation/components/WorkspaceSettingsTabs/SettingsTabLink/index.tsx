import { NavLink } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { TabNavLink } from '@orthacms/design-system';
import type { WorkspaceSettingsTab } from '../../../slots/workspaceSlots';

/**
 * One plugin-contributed settings tab, gating itself on the permission the
 * contribution named.
 *
 * A component rather than a branch inside the parent's `.map`, because the
 * check is a hook: calling `useHasPermission` once per item inside a callback
 * makes the number of hook calls a function of how many plugins are installed.
 * Slot items are frozen at boot so that number cannot actually change between
 * renders — but the next contributor should be adding an item, not learning
 * why the rule tolerated the previous one.
 *
 * A tab without the permission renders **nothing**, matching the Danger zone:
 * a link to a page that will refuse you is worse than no link. The route
 * itself stays mounted, so a deep link reaches a section that can explain the
 * refusal instead of bouncing somewhere the person did not ask for.
 */
export function SettingsTabLink({
    base,
    tab
}: {
    /** `/workspaces/:id/settings` — the prefix every entry links from. */
    base: string;
    /** The contribution being rendered. */
    tab: WorkspaceSettingsTab;
}) {
    const intl = useIntl();
    // Hooks run unconditionally; `undefined` is a permission nobody is missing.
    const permitted = useHasPermission(tab.permission ?? '');
    if (tab.permission && !permitted) return null;

    const Icon = tab.icon;
    return (
        <TabNavLink asChild>
            <NavLink to={`${base}/${tab.path}`}>
                <Icon aria-hidden className="size-4 shrink-0" />
                {intl.formatMessage({
                    id: tab.labelId,
                    defaultMessage: tab.defaultLabel
                })}
            </NavLink>
        </TabNavLink>
    );
}
