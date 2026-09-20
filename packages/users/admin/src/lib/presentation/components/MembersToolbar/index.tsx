import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { SearchToolbar } from '@orthacms/design-system';

/** Intl descriptors for {@link MembersToolbar}, co-located with the component. */
const messages = defineMessages({
    searchLabel: {
        id: 'users.toolbar.searchLabel',
        defaultMessage: 'Search members by name or email'
    },
    searchPlaceholder: {
        id: 'users.toolbar.searchPlaceholder',
        defaultMessage: 'Search by name or email'
    }
});

/**
 * The Members table toolbar: a name/email search box with the advanced-filter
 * control pinned to the right. Layout lives in the shared `SearchToolbar`; this
 * wrapper only supplies the localised strings and the page-owned filter control.
 */
export function MembersToolbar({
    search,
    onSearchChange,
    filterControl,
    busy = false
}: {
    search: string;
    onSearchChange: (value: string) => void;
    /** Whether a search/filter request driven from here is still settling. */
    busy?: boolean;
    /** Optional advanced-filter control rendered on the right. */
    filterControl?: ReactNode;
}) {
    const intl = useIntl();

    return (
        <SearchToolbar
            busy={busy}
            value={search}
            onValueChange={onSearchChange}
            searchLabel={intl.formatMessage(messages.searchLabel)}
            searchPlaceholder={intl.formatMessage(messages.searchPlaceholder)}
            actions={filterControl}
        />
    );
}
