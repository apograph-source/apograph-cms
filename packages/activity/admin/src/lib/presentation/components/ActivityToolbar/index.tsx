import type { Ref, ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { SearchToolbar } from '@orthacms/design-system';

/** Intl descriptors for {@link ActivityToolbar}, co-located. */
const messages = defineMessages({
    searchLabel: {
        id: 'activity.toolbar.searchLabel',
        defaultMessage: 'Search by actor email'
    },
    searchPlaceholder: {
        id: 'activity.toolbar.searchPlaceholder',
        defaultMessage: 'Search by actor email'
    }
});

type ActivityToolbarProps = {
    /** Actor-email search box value. */
    email: string;
    onEmailChange: (value: string) => void;
    /** Optional advanced-filter control rendered on the right. */
    filterControl?: ReactNode;
    /** Whether a search/filter request driven from here is still settling. */
    busy?: boolean;
    /** Ref to the search input, so the page can restore focus to it. */
    searchRef?: Ref<HTMLInputElement>;
};

/**
 * The Activity Log toolbar: an actor-email search box with the advanced-filter
 * control pinned to the right. Layout lives in the shared `SearchToolbar`; this
 * wrapper only supplies the localised strings and the page-owned filter control.
 */
export function ActivityToolbar({
    email,
    onEmailChange,
    filterControl,
    busy = false,
    searchRef
}: ActivityToolbarProps) {
    const intl = useIntl();

    return (
        <SearchToolbar
            busy={busy}
            inputRef={searchRef}
            value={email}
            onValueChange={onEmailChange}
            searchLabel={intl.formatMessage(messages.searchLabel)}
            searchPlaceholder={intl.formatMessage(messages.searchPlaceholder)}
            actions={filterControl}
        />
    );
}
