import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandList,
    Kbd
} from '@orthacms/design-system';
import type { ContentType } from '../../../domain/types/contentType';
import { groupContentTypes } from '../../../domain/groupContentTypes';
import { ContentSearchItem } from './ContentSearchItem';

/** Intl descriptors for the content search palette, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.search.title',
        defaultMessage: 'Search content types'
    },
    description: {
        id: 'content.search.description',
        defaultMessage: 'Find and open a collection or page.'
    },
    placeholder: {
        id: 'content.search.placeholder',
        defaultMessage: 'Search collections and pages…'
    },
    empty: {
        id: 'content.search.empty',
        defaultMessage: 'No content types found.'
    },
    matchCount: {
        id: 'content.search.matchCount',
        defaultMessage:
            '{count, plural, one {# content type matches} other {# content types match}}.'
    },
    footerNavigate: {
        id: 'content.search.footerNavigate',
        defaultMessage: 'to navigate'
    },
    footerOpen: {
        id: 'content.search.footerOpen',
        defaultMessage: 'to open'
    },
    footerClose: {
        id: 'content.search.footerClose',
        defaultMessage: 'to close'
    },
    collectionsGroup: {
        id: 'content.search.collectionsGroup',
        defaultMessage: 'Collections'
    },
    pagesGroup: {
        id: 'content.search.pagesGroup',
        defaultMessage: 'Pages'
    },
    collectionBadge: {
        id: 'content.search.collectionBadge',
        defaultMessage: 'Collection'
    },
    pageBadge: {
        id: 'content.search.pageBadge',
        defaultMessage: 'Page'
    }
});

type ContentSearchDialogProps = {
    /** Whether the palette is open. */
    open: boolean;
    /** Open/close handler. */
    onOpenChange: (open: boolean) => void;
    /** Every content type in the workspace. */
    types: ContentType[];
    /** Absolute base path for the library (`/workspaces/:id/content`). */
    basePath: string;
};

/**
 * The ⌘K command palette over the workspace's content types. Built on
 * `CommandDialog` (Command inside Dialog — focus trap, ESC, arrow-key nav, and
 * an auto-focused input come for free), it lists Collections and Pages; choosing
 * one navigates to its route and closes the palette.
 */
export function ContentSearchDialog({
    open,
    onOpenChange,
    types,
    basePath
}: ContentSearchDialogProps) {
    const intl = useIntl();
    const navigate = useNavigate();
    const { collections, pages } = groupContentTypes(types);

    // cmdk announces the *focused* option as the user arrows, but nothing said
    // how many options are left — so a keystroke that cut the list from twelve
    // rows to one was indistinguishable from one that changed nothing, short of
    // arrowing through the whole list (WCAG 4.1.3). cmdk unmounts filtered-out
    // items, so the rendered `[cmdk-item]` count *is* the match count; read it
    // after each keystroke rather than re-implementing cmdk's own scoring.
    // A **callback** ref, not `useRef`: the dialog's content mounts through a
    // portal a beat after `open` flips, so an effect keyed on `open` runs with
    // the ref still null and the observer below is never attached.
    const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
    const [search, setSearch] = useState('');
    const [matches, setMatches] = useState(0);
    // Observed rather than derived from `search`: cmdk re-filters in its own
    // commit, so reading the list in an effect keyed on the query is one
    // keystroke behind (and reads nothing at all on the first open, before the
    // portal has mounted). A MutationObserver fires *after* cmdk has finished
    // adding and removing rows, so the number announced is the number shown.
    useEffect(() => {
        if (!listEl) return;
        const count = () =>
            setMatches(listEl.querySelectorAll('[cmdk-item]').length);
        count();
        const observer = new MutationObserver(count);
        observer.observe(listEl, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [listEl]);
    // Reset between openings so a stale query never seeds the next visit.
    useEffect(() => {
        if (!open) setSearch('');
    }, [open]);

    const select = (type: ContentType) => {
        onOpenChange(false);
        navigate(`${basePath}/${type.name}`);
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
        >
            <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder={intl.formatMessage(messages.placeholder)}
            />
            {/* The zero case is announced by `CommandEmpty`; this covers every
                other count, which nothing else in the palette states. */}
            <p role="status" aria-live="polite" className="sr-only">
                {matches > 0
                    ? intl.formatMessage(messages.matchCount, {
                          count: matches
                      })
                    : ''}
            </p>
            {/* Fixed height so the dialog doesn't resize/jump as results filter. */}
            <CommandList ref={setListEl} className="h-80 max-h-none">
                <CommandEmpty>
                    {intl.formatMessage(messages.empty)}
                </CommandEmpty>
                {collections.length > 0 ? (
                    <CommandGroup
                        heading={intl.formatMessage(messages.collectionsGroup)}
                    >
                        {collections.map((type) => (
                            <ContentSearchItem
                                key={type.name}
                                type={type}
                                badge={intl.formatMessage(
                                    messages.collectionBadge
                                )}
                                onSelect={select}
                            />
                        ))}
                    </CommandGroup>
                ) : null}
                {pages.length > 0 ? (
                    <CommandGroup
                        heading={intl.formatMessage(messages.pagesGroup)}
                    >
                        {pages.map((type) => (
                            <ContentSearchItem
                                key={type.name}
                                type={type}
                                badge={intl.formatMessage(messages.pageBadge)}
                                onSelect={select}
                            />
                        ))}
                    </CommandGroup>
                ) : null}
            </CommandList>
            <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    {intl.formatMessage(messages.footerNavigate)}
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>↵</Kbd>
                    {intl.formatMessage(messages.footerOpen)}
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>esc</Kbd>
                    {intl.formatMessage(messages.footerClose)}
                </span>
            </div>
        </CommandDialog>
    );
}
