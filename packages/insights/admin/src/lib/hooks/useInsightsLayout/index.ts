import { useMemo } from 'react';
import { AuthStatus, useAuth } from '@orthacms/identity-admin';
import {
    INSIGHTS_SECTION_SLOT,
    INSIGHTS_WIDGET_SLOT
} from '../../presentation/slots/insightsSlots';
import {
    resolveInsightsLayout,
    type InsightsBand
} from '../../utils/resolveInsightsLayout';

export type { InsightsBand } from '../../utils/resolveInsightsLayout';

/**
 * The band that catches widgets naming a section nobody registered.
 *
 * Named "More" rather than something apologetic: to a reader it is simply the
 * last group on the page, and nothing about it should suggest a fault. It only
 * ever appears when a plugin's `section` id doesn't match a registration.
 */
const FALLBACK_SECTION = {
    id: 'other',
    titleId: 'insights.section.other',
    defaultTitle: 'More'
};

/**
 * Resolves the Insights page layout: every registered section, in order, with
 * the widgets the signed-in user is allowed to see.
 *
 * A thin adapter — it reads the two slots and the auth state and hands them to
 * the pure {@link resolveInsightsLayout}, which owns every rule that could
 * otherwise quietly lose a contributed card. Permissions are read **once** from
 * the auth state rather than by calling `useHasPermission` per widget: slot
 * registration is frozen at boot so a hook per item would be safe, but resolving
 * the set up front is what lets the page decide whether a section has any
 * visible widgets *before* rendering its heading.
 */
export function useInsightsLayout(): InsightsBand[] {
    const auth = useAuth();
    const permissions =
        auth.status === AuthStatus.Authenticated ? auth.user.permissions : [];

    // The permission list is a new array each render; keying the memo on its
    // contents rather than its identity keeps the layout stable across renders.
    const permissionKey = permissions.join(',');

    return useMemo(
        () =>
            resolveInsightsLayout({
                sections: INSIGHTS_SECTION_SLOT.getItems(),
                widgets: INSIGHTS_WIDGET_SLOT.getItems(),
                permissions: permissionKey ? permissionKey.split(',') : [],
                fallback: FALLBACK_SECTION
            }),
        [permissionKey]
    );
}
