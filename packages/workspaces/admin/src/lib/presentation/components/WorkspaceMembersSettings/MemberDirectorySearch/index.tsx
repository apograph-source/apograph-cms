import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Search } from 'lucide-react';
import {
    cn,
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    Popover,
    PopoverAnchor,
    PopoverContent,
    Spinner
} from '@orthacms/design-system';
import { useUsersSearch } from '../../../../application/useUsersSearch';
import type { DirectoryUser } from '../../../../domain/types/wizard';
import { useComboboxList } from '../../../hooks/useComboboxList';

const messages = defineMessages({
    placeholder: {
        id: 'workspaces.settings.members.searchPlaceholder',
        defaultMessage: 'Add people by name or email'
    },
    searching: {
        id: 'workspaces.settings.members.searching',
        defaultMessage: 'Searching…'
    },
    results: {
        id: 'workspaces.settings.members.resultsAnnouncement',
        defaultMessage:
            '{count, plural, =0 {No people match your search.} one {# person available.} other {# people available.}}'
    },
    noResults: {
        id: 'workspaces.settings.members.noResults',
        defaultMessage: 'No people match your search.'
    },
    loadError: {
        id: 'workspaces.settings.members.loadError',
        defaultMessage: 'Couldn’t load people. Please try again.'
    }
});

/** Props for {@link MemberDirectorySearch}. */
export type MemberDirectorySearchProps = {
    /** Ids already members — excluded from results so they can't be re-added. */
    excludeIds: Set<string>;
    /** Called when a directory user is chosen. */
    onSelect: (user: DirectoryUser) => void;
    /** Disables the input while an add is in flight. */
    busy?: boolean;
};

/**
 * Searchable input that assigns **existing** directory users to the workspace.
 * Unlike the create wizard's typeahead there is no invite-by-email path — the
 * add-member endpoint links a real account by id — so a typed email that isn't
 * in the directory simply yields no result.
 */
export function MemberDirectorySearch({
    excludeIds,
    onSelect,
    busy = false
}: MemberDirectorySearchProps) {
    const intl = useIntl();
    const [query, setQuery] = useState('');
    const { users, loading, isError } = useUsersSearch(query);

    const trimmed = query.trim();
    const results = users.filter((user) => !excludeIds.has(user.id));
    const open = trimmed.length > 0;

    const select = (user: DirectoryUser) => {
        onSelect(user);
        setQuery('');
    };

    const combobox = useComboboxList({
        count: results.length,
        open,
        onSelect: (index) => {
            const user = results[index];
            if (user) select(user);
        },
        onDismiss: () => setQuery('')
    });

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (!next) setQuery('');
            }}
        >
            <PopoverAnchor asChild>
                <InputGroup className="shadow-none">
                    <InputGroupAddon>
                        <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={combobox.onKeyDown}
                        placeholder={intl.formatMessage(messages.placeholder)}
                        aria-label={intl.formatMessage(messages.placeholder)}
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={combobox.listboxId}
                        aria-activedescendant={combobox.activeId}
                        aria-autocomplete="list"
                        autoComplete="off"
                        disabled={busy}
                    />
                </InputGroup>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="w-[var(--radix-popover-trigger-width)] p-1"
            >
                {loading ? (
                    <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                        <Spinner className="size-3.5" />
                        {intl.formatMessage(messages.searching)}
                    </p>
                ) : isError ? (
                    <p
                        role="alert"
                        className="px-2 py-2 text-sm text-destructive"
                    >
                        {intl.formatMessage(messages.loadError)}
                    </p>
                ) : results.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                        {intl.formatMessage(messages.noResults)}
                    </p>
                ) : (
                    <ul
                        id={combobox.listboxId}
                        role="listbox"
                        aria-label={intl.formatMessage(messages.placeholder)}
                        className="flex flex-col"
                    >
                        {results.map((user, i) => (
                            <li
                                key={user.id}
                                id={combobox.optionId(i)}
                                role="option"
                                aria-selected={combobox.activeIndex === i}
                                onClick={() => select(user)}
                                onMouseEnter={() => combobox.setActiveIndex(i)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                                    combobox.activeIndex === i && 'bg-accent'
                                )}
                            >
                                <span className="truncate font-medium">
                                    {user.name}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {user.email}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </PopoverContent>
            {/* Result arrival is otherwise silent; the error state has its own
                `role="alert"` inside the popover. */}
            <span role="status" aria-live="polite" className="sr-only">
                {!open || loading || isError
                    ? ''
                    : intl.formatMessage(messages.results, {
                          count: results.length
                      })}
            </span>
        </Popover>
    );
}
