import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { AlertTriangle, Check, ChevronDown, Globe } from 'lucide-react';
import {
    Button,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn
} from '@orthacms/design-system';
import type { RecordsToolbarContext } from '@orthacms/content-admin';
import { LOCALE_PARAM } from '../../constants';
import {
    findLocale,
    localeAttrs,
    localeName,
    resolveActiveLocale,
    toLocaleListParam
} from '../../domain/localePolicy';
import { useLocales } from '../../api/useLocales';
import {
    beginLocaleSwitch,
    cancelPendingLocaleSwitch
} from '../../utils/localeTransition';

const messages = defineMessages({
    label: {
        id: 'i18n.switcher.label',
        defaultMessage: 'Locale: {name}'
    },
    list: {
        id: 'i18n.switcher.list',
        defaultMessage: 'Locales'
    },
    searchPlaceholder: {
        id: 'i18n.switcher.searchPlaceholder',
        defaultMessage: 'Search locales…'
    },
    empty: {
        id: 'i18n.switcher.empty',
        defaultMessage: 'No locale found.'
    },
    defaultSuffix: {
        id: 'i18n.switcher.defaultSuffix',
        defaultMessage: '{name} (default)'
    },
    unknown: {
        id: 'i18n.switcher.unknown',
        defaultMessage: 'Unknown locale “{slug}”'
    },
    unknownLabel: {
        id: 'i18n.switcher.unknownLabel',
        defaultMessage:
            'Locale: unknown locale “{slug}”. Pick a configured locale to fix the list.'
    },
    failed: {
        id: 'i18n.switcher.failed',
        defaultMessage: 'Locales unavailable'
    },
    failedLabel: {
        id: 'i18n.switcher.failedLabel',
        defaultMessage:
            'Locales could not be loaded, so the locale of this list can’t be changed. Press to retry.'
    }
});

/** Case-insensitive match of a locale's name/slug against the search query. */
function matches(haystack: string, query: string): boolean {
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * The records-toolbar **locale switcher** — a searchable dropdown of the
 * configured locales, contributed into the Content Library's toolbar slot.
 * The active locale is the table's `?locale=` URL param (owned by this item's
 * `listParamKeys`); the default locale keeps a clean URL, matching the
 * server's default scoping. Renders nothing for a non-i18n type.
 *
 * Structured like the records column picker / query-builder field picker (a
 * padded `Popover` + a plain `Input` over one `overflow-y-auto` list) rather
 * than a cmdk `Command`, so the mouse wheel scrolls the list and the rounded
 * border stays clean. The trigger keeps its `Locale: {name}` label and each row
 * `role="option"`.
 *
 * Dropping cmdk means owning the keyboard contract it used to provide: focus
 * stays in the search box, ↑/↓ move an `aria-activedescendant` highlight and
 * Enter picks — rows are `tabIndex={-1}` so a long locale list isn't a Tab
 * gauntlet, and a `listbox` whose options are only reachable by Tab would
 * announce a position the keyboard can't act on. The search box carries
 * `role="combobox"` because that is the role `aria-activedescendant` is
 * defined against — on a plain textbox it is widely ignored, so the highlight
 * would move silently as you arrow through the list.
 *
 * **It renders on failure too.** This control owns `?locale=`, so it is the
 * only way back out of a non-default locale; returning `null` when the locale
 * read fails removed the exit while leaving the list scoped, stranding the
 * user in a language they could no longer leave.
 */
export function LocaleSwitcher({
    schema,
    params,
    updateParams
}: RecordsToolbarContext) {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listId = useId();
    const { locales, defaultLocale, isError, refetch } = useLocales();

    const activeSlug = resolveActiveLocale({
        urlLocale: params[LOCALE_PARAM],
        defaultSlug: defaultLocale?.slug
    });

    const filtered = useMemo(
        () =>
            locales.filter((locale) =>
                matches(`${locale.slug} ${locale.name}`, query)
            ),
        [locales, query]
    );

    // Narrowing the search can leave the highlight past the end of the list,
    // which would make Enter a no-op.
    useEffect(() => setActiveIndex(0), [query, open]);

    // A pick schedules its re-scope behind the cover; if this toolbar goes away
    // first the swap is stale, so drop it rather than re-scoping a list the
    // user has left.
    useEffect(() => cancelPendingLocaleSwitch, []);

    if (!schema.i18n) return null;

    if (isError) {
        return (
            <Button
                variant="outline"
                className="shadow-none text-destructive"
                aria-label={intl.formatMessage(messages.failedLabel)}
                onClick={() => refetch()}
            >
                <AlertTriangle aria-hidden className="size-4" />
                {intl.formatMessage(messages.failed)}
            </Button>
        );
    }

    // Fewer than **two** locales, not zero: a workspace with a single
    // configured locale rendered a switcher whose menu could only offer the
    // locale already selected — a control with nothing to change. The records
    // toolbar carries it on every collection of every localized type, so this
    // is the one button on the row that a single-locale install simply does
    // not need.
    if (locales.length < 2) return null;

    // Deliberately **not** `?? defaultLocale`: an unconfigured `?locale=` still
    // goes to the server (which 400s it), so claiming the default here would
    // label a broken list with a locale it is not showing.
    const active = findLocale(locales, activeSlug);
    const unknownSlug = activeSlug && !active ? activeSlug : undefined;

    const select = (slug: string) => {
        setOpen(false);
        // Re-selecting the active locale is a no-op — no re-scope, no flourish.
        // Skipped while the URL names an unknown locale: there the "no-op" is
        // the one press that clears the bad param, so it has to go through.
        if (!unknownSlug && slug === active?.slug) return;
        const name = localeName(locales, slug) ?? slug;
        // Defer the re-scope until the overlay covers the page (see
        // `beginLocaleSwitch`) so the table doesn't visibly swap under the blur.
        beginLocaleSwitch(name, () => {
            updateParams({
                // Default locale = clean URL — the server scopes to it when the
                // param is absent, so the two spellings can't drift.
                [LOCALE_PARAM]: toLocaleListParam(slug, defaultLocale?.slug)
            });
        });
    };

    const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (filtered.length === 0) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((i) => (i + 1) % filtered.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
        } else if (event.key === 'Enter') {
            const locale = filtered[activeIndex];
            if (!locale) return;
            event.preventDefault();
            select(locale.slug);
        }
    };

    return (
        <>
            <Popover
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) setQuery('');
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className={cn(
                            'shadow-none',
                            unknownSlug && 'text-destructive'
                        )}
                        aria-label={
                            unknownSlug
                                ? intl.formatMessage(messages.unknownLabel, {
                                      slug: unknownSlug
                                  })
                                : intl.formatMessage(messages.label, {
                                      name: active?.name ?? ''
                                  })
                        }
                    >
                        {unknownSlug ? (
                            <AlertTriangle aria-hidden className="size-4" />
                        ) : (
                            <Globe aria-hidden className="size-4" />
                        )}
                        {unknownSlug ? (
                            intl.formatMessage(messages.unknown, {
                                slug: unknownSlug
                            })
                        ) : (
                            // The locale's own name is in that locale, so it
                            // carries its own language/direction — otherwise a
                            // screen reader says "Deutsch" with English
                            // phonemes, before any content is even opened.
                            <span {...localeAttrs(locales, active?.slug)}>
                                {active?.name}
                            </span>
                        )}
                        <ChevronDown
                            aria-hidden
                            className="size-3.5 text-muted-foreground"
                        />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    className="w-56 p-2"
                    onKeyDown={onListKeyDown}
                >
                    <Input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={intl.formatMessage(
                            messages.searchPlaceholder
                        )}
                        aria-label={intl.formatMessage(
                            messages.searchPlaceholder
                        )}
                        // `aria-activedescendant` is only honoured on a role
                        // that owns options — on a bare textbox the highlight
                        // moves silently. The Radix trigger's `haspopup` names
                        // the *popover*, not this list, so the combobox role
                        // has to be declared here.
                        role="combobox"
                        aria-expanded
                        aria-haspopup="listbox"
                        aria-autocomplete="list"
                        aria-controls={listId}
                        aria-activedescendant={
                            filtered[activeIndex]
                                ? `${listId}-${filtered[activeIndex].slug}`
                                : undefined
                        }
                        className="mb-1 h-8 rounded-lg shadow-none"
                    />
                    {/* Only the list scrolls (plain container → mouse wheel
                        works), so the search box stays put. */}
                    <div
                        id={listId}
                        role="listbox"
                        aria-label={intl.formatMessage(messages.list)}
                        className="max-h-72 overflow-y-auto"
                    >
                        {filtered.length === 0 ? (
                            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                                {intl.formatMessage(messages.empty)}
                            </p>
                        ) : (
                            filtered.map((locale, index) => {
                                const isActive = locale.slug === active?.slug;
                                const isHighlighted = index === activeIndex;
                                // Keyed because it is interpolated into a
                                // message: react-intl splices rich values into
                                // a children array, and an unkeyed element
                                // there is a React list-key warning.
                                const nameNode = (
                                    <span
                                        key="name"
                                        {...localeAttrs(locales, locale.slug)}
                                    >
                                        {locale.name}
                                    </span>
                                );
                                return (
                                    <button
                                        key={locale.slug}
                                        id={`${listId}-${locale.slug}`}
                                        type="button"
                                        tabIndex={-1}
                                        role="option"
                                        aria-selected={isActive}
                                        onMouseEnter={() =>
                                            setActiveIndex(index)
                                        }
                                        onClick={() => select(locale.slug)}
                                        className={cn(
                                            'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm',
                                            'hover:bg-accent hover:text-accent-foreground',
                                            isHighlighted &&
                                                'bg-accent text-accent-foreground',
                                            isActive &&
                                                !isHighlighted &&
                                                'bg-accent/50'
                                        )}
                                    >
                                        <Check
                                            aria-hidden
                                            className={cn(
                                                'mr-2 size-4 shrink-0',
                                                isActive
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            )}
                                        />
                                        {/* Only the locale's own name carries
                                            its language — the "(default)"
                                            qualifier is UI copy in the admin's
                                            language, so wrapping the whole
                                            string would mark that as German
                                            too. */}
                                        <span className="truncate">
                                            {locale.isDefault
                                                ? intl.formatMessage(
                                                      messages.defaultSuffix,
                                                      { name: nameNode }
                                                  )
                                                : nameNode}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </>
    );
}
