import { defineMessages, useIntl } from 'react-intl';
import { Search } from 'lucide-react';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    SegmentedControl,
    SegmentedControlCount,
    SegmentedControlItem
} from '@orthacms/design-system';

/** The status the list is filtered by. `Active` is the default view. */
export type StatusFilter = 'All' | 'Active' | 'Archived';

/** The default status filter. */
export const DEFAULT_STATUS: StatusFilter = 'Active';

/** Intl descriptors for {@link WorkspaceToolbar}, co-located with the component. */
const messages = defineMessages({
    searchLabel: {
        id: 'workspaces.toolbar.searchLabel',
        defaultMessage: 'Search workspaces'
    },
    searchPlaceholder: {
        id: 'workspaces.toolbar.searchPlaceholder',
        defaultMessage: 'Search workspaces'
    },
    statusLegend: {
        id: 'workspaces.toolbar.statusLegend',
        defaultMessage: 'Filter by status'
    },
    statusAll: {
        id: 'workspaces.toolbar.statusAll',
        defaultMessage: 'All'
    },
    statusActive: {
        id: 'workspaces.toolbar.statusActive',
        defaultMessage: 'Active'
    },
    statusArchived: {
        id: 'workspaces.toolbar.statusArchived',
        defaultMessage: 'Archived'
    },
    count: {
        id: 'workspaces.toolbar.count',
        defaultMessage: '{shown} of {total}'
    },
    countAnnouncement: {
        id: 'workspaces.toolbar.countAnnouncement',
        defaultMessage:
            '{shown, plural, one {# workspace shown} other {# workspaces shown}} of {total}.'
    },
    statusOption: {
        id: 'workspaces.toolbar.statusOption',
        defaultMessage:
            '{label}, {count, plural, one {# workspace} other {# workspaces}}'
    }
});

const STATUS_OPTIONS: StatusFilter[] = ['All', 'Active', 'Archived'];

type WorkspaceToolbarProps = {
    search: string;
    onSearchChange: (value: string) => void;
    status: StatusFilter;
    onStatusChange: (value: StatusFilter) => void;
    /** How many workspaces fall under each status (for the chip counts). */
    counts: Record<StatusFilter, number>;
    shown: number;
    total: number;
};

/**
 * The list toolbar: a search box, the status filter as a segmented chip group
 * (All / Active / Archived, each badged with its count), and a live
 * "{shown} of {total}" count. Wraps to multiple rows on narrow viewports.
 */
export function WorkspaceToolbar({
    search,
    onSearchChange,
    status,
    onStatusChange,
    counts,
    shown,
    total
}: WorkspaceToolbarProps) {
    const intl = useIntl();

    const statusLabel: Record<StatusFilter, string> = {
        All: intl.formatMessage(messages.statusAll),
        Active: intl.formatMessage(messages.statusActive),
        Archived: intl.formatMessage(messages.statusArchived)
    };

    return (
        <div className="mb-4 flex flex-wrap items-center gap-3">
            <InputGroup className="w-full shadow-none sm:max-w-[360px]">
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    type="search"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    aria-label={intl.formatMessage(messages.searchLabel)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                />
            </InputGroup>

            <SegmentedControl
                value={status}
                // Radix single-toggle can emit '' when the active chip is
                // re-clicked; ignore that so a status is always selected.
                onValueChange={(value) => {
                    if (value) {
                        onStatusChange(value as StatusFilter);
                    }
                }}
                aria-label={intl.formatMessage(messages.statusLegend)}
            >
                {STATUS_OPTIONS.map((option) => (
                    <SegmentedControlItem
                        key={option}
                        value={option}
                        // The badge stays `aria-hidden` so the count isn't read
                        // as a stray number after the label — but the number is
                        // decision-shaping ("Archived" hiding 2 workspaces reads
                        // very differently from 0), so it moves into the radio's
                        // own name rather than being dropped from the a11y tree.
                        aria-label={intl.formatMessage(messages.statusOption, {
                            label: statusLabel[option],
                            count: counts[option]
                        })}
                    >
                        {statusLabel[option]}
                        <SegmentedControlCount aria-hidden>
                            {counts[option]}
                        </SegmentedControlCount>
                    </SegmentedControlItem>
                ))}
            </SegmentedControl>

            {/* The visible count is the only feedback that a search or a status
                change did anything — the table just silently swaps rows. A
                polite live region restates it so that lands for a screen-reader
                user too; `aria-hidden` on the visible span keeps it from being
                announced twice (once as content, once as the live update). */}
            <span aria-hidden className="ml-auto text-sm text-muted-foreground">
                {intl.formatMessage(messages.count, { shown, total })}
            </span>
            <span role="status" aria-live="polite" className="sr-only">
                {intl.formatMessage(messages.countAnnouncement, {
                    shown,
                    total
                })}
            </span>
        </div>
    );
}
