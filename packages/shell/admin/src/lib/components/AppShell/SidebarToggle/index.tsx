import type * as React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { SidebarTrigger, useSidebar } from '@orthacms/design-system';

/** Intl descriptors for {@link SidebarToggle}, co-located with the component. */
const messages = defineMessages({
    show: {
        id: 'shell.sidebarToggle.show',
        defaultMessage: 'Show navigation'
    }
});

/**
 * The floating reveal button for the collapsed sidebar. Fixed to the top-left,
 * it appears only when the sidebar is hidden — collapsed on desktop, or on
 * mobile (where the sidebar is an overlay drawer) — so it never steals layout
 * space. When the sidebar is open on desktop the in-header trigger collapses
 * it, so this button would just overlap the panel and is hidden.
 *
 * Pages that render a `TopBar` carry their own inline reveal trigger, so this
 * floating fallback also hides itself (via `:has()`) whenever the open page
 * has one — it only ever shows on bar-less pages (the Home dashboard).
 */
export function SidebarToggle({
    ...props
}: React.ComponentProps<typeof SidebarTrigger>) {
    const intl = useIntl();
    const { state, isMobile } = useSidebar();

    if (!isMobile && state === 'expanded') {
        return null;
    }

    return (
        // This button only ever renders while the sidebar is hidden, so it
        // always *shows* — a generic "Toggle Sidebar" would name the component
        // rather than what pressing it does (`ORT-159`).
        <SidebarTrigger
            label={intl.formatMessage(messages.show)}
            className="fixed left-2 top-2 z-30 size-8 rounded-lg border border-border bg-background shadow-sm [main:has([data-slot=top-bar])~&]:hidden"
            {...props}
        />
    );
}
