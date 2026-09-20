import { useMatch } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Settings } from 'lucide-react';
import { PageTopBar, type PageTopBarCrumb } from '@orthacms/shell-admin';

/** Intl descriptors for {@link WorkspaceSettingsTopBar}, co-located here. */
const messages = defineMessages({
    settings: {
        id: 'workspaces.settings.topbar.settings',
        defaultMessage: 'Settings'
    },
    general: {
        id: 'workspaces.settings.topbar.general',
        defaultMessage: 'General'
    },
    members: {
        id: 'workspaces.settings.topbar.members',
        defaultMessage: 'Members'
    },
    content: {
        id: 'workspaces.settings.topbar.content',
        defaultMessage: 'Content'
    },
    danger: {
        id: 'workspaces.settings.topbar.danger',
        defaultMessage: 'Danger zone'
    }
});

/** Section route segment → its crumb label. */
const SECTION_MESSAGES = {
    general: messages.general,
    members: messages.members,
    content: messages.content,
    danger: messages.danger
} as const;

/**
 * The page-context bar over the workspace settings page: the same `Settings`
 * icon the workspace sidebar nav uses, plus a "Settings › {section}"
 * breadcrumb derived from the active nested route (the tab bar below owns
 * navigation, so the crumbs are plain text).
 */
export function WorkspaceSettingsTopBar() {
    const intl = useIntl();
    const match = useMatch('/workspaces/:workspaceId/settings/:section');
    const section = match?.params.section as
        | keyof typeof SECTION_MESSAGES
        | undefined;
    const sectionMessage = section ? SECTION_MESSAGES[section] : undefined;

    const crumbs: PageTopBarCrumb[] = [
        { key: 'settings', label: intl.formatMessage(messages.settings) }
    ];
    if (sectionMessage) {
        crumbs.push({
            key: section as string,
            label: intl.formatMessage(sectionMessage)
        });
    }

    return (
        <PageTopBar
            icon={Settings}
            iconClassName="bg-violet-soft text-violet-soft-foreground"
            crumbs={crumbs}
        />
    );
}
