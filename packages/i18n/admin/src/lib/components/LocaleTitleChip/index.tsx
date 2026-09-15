import { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    badgeVariants,
    cn
} from '@apograph/design-system';
import { useHasPermission } from '@apograph/identity-admin';
import { useUnsavedChangesApi } from '@apograph/utils-admin';
import {
    ENTRY_MODE,
    type EntryStatus,
    type EntrySlotContext
} from '@apograph/content-admin';
import {
    CONTENT_CREATE,
    LOCALE_GROUP_PARAM,
    LOCALE_PARAM
} from '../../constants';
import {
    isDefaultLocale,
    localeAttrs,
    localeName,
    resolveActiveLocale
} from '../../domain/localePolicy';
import { useLocales } from '../../api/useLocales';
import { useEntryLocales } from '../../api/useEntryLocales';
import { useLocaleSummaries } from '../../api/useLocaleSummaries';
import {
    beginLocaleSwitch,
    cancelPendingLocaleSwitch
} from '../../utils/localeTransition';
import { LocaleMenuItem } from './LocaleMenuItem';

const messages = defineMessages({
    label: {
        id: 'i18n.title.currentLocale',
        defaultMessage: 'Current locale: {name}'
    },
    trigger: {
        id: 'i18n.localeMenu.trigger',
        defaultMessage:
            'Locale: {name}. {translated} of {total} translated. Choose a locale'
    },
    count: {
        id: 'i18n.localeMenu.count',
        defaultMessage: '{translated}/{total}'
    },
    heading: {
        id: 'i18n.localeMenu.heading',
        defaultMessage: 'Locales'
    },
    localesUnavailable: {
        id: 'i18n.localeMenu.localesUnavailable',
        defaultMessage:
            'The configured locales couldn’t be loaded, so there is nothing to choose from.'
    },
    localesPending: {
        id: 'i18n.localeMenu.localesPending',
        defaultMessage: 'Loading locales…'
    },
    localesNone: {
        id: 'i18n.localeMenu.localesNone',
        defaultMessage: 'No locales are configured.'
    },
    localesRetry: {
        id: 'i18n.localeMenu.localesRetry',
        defaultMessage: 'Reload locales'
    },
    loadFailed: {
        id: 'i18n.widget.loadFailed',
        defaultMessage:
            'This record’s other locales couldn’t be loaded, so none are listed below. Some may already exist.'
    },
    retry: {
        id: 'i18n.widget.retry',
        defaultMessage: 'Try again'
    }
});

/**
 * What a read **is** right now — three states, never two.
 *
 * Both of this chip's reads have a window in which the answer is not yet known,
 * and collapsing that into the two states that *are* answers is how `i18n:I-30`
 * ("an error is not an emptiness") gets broken in the other direction: a
 * pending locale list reads as a failed one, and pending group members read as
 * "this locale has no translation" — an invitation to create a sibling that may
 * already exist, whose save then 409s. Naming the third state is the fix;
 * everything below branches on it rather than on a pair of booleans.
 */
type ReadState = 'pending' | 'failed' | 'known';

/** Classify a TanStack query's two flags into the three states above. */
function readState(query: {
    isPending: boolean;
    isError: boolean;
}): ReadState {
    // Error first: a retry leaves `isPending` false but the last answer is
    // still a failure, and a failure is the more specific thing to say.
    if (query.isError) return 'failed';
    return query.isPending ? 'pending' : 'known';
}

/** A group member resolved for one locale slug (its row id + publish status). */
type Sibling = {
    id: string;
    status?: EntryStatus;
    /** When this locale last went live — read with `status` for the badge. */
    publishedAt?: string | null;
};

/**
 * The chip beside the entry-editor title: which **locale** the open record is
 * in (the uppercased code and display name, e.g. `EN · English`), how much of
 * the translation group exists (`2/3`), and — as a menu — the way to any other
 * locale. Contributed into the content library's title-row slot; renders
 * nothing for a non-i18n type. The current locale is resolved by
 * `resolveActiveLocale`, the plugin's single decision point: the saved entry's
 * locale, else `?locale=`, else the default.
 *
 * The gate is the **schema**, not the locale list: on a saved localized record
 * the row's own `locale` is enough to name it, so a failed locale read costs
 * the display name and the choices — which the menu says, with a retry — not
 * the whole chip.
 *
 * It works in **both** modes. On a **saved** record the group's members come
 * from `useEntryLocales`; a missing locale opens a draft create form scoped to
 * that locale + group. On a **new/unsaved** record you can still switch the
 * form's target locale before filling it in (re-scoping `?locale=` in place),
 * and — when the create is a translation into an existing group — jump to a
 * sibling that already exists (its members come from `useLocaleSummaries`).
 *
 * **Everything stateful lives here, not in the menu.** A pick does not navigate
 * immediately: `beginLocaleSwitch` schedules the swap behind the cover, and
 * `cancelPendingLocaleSwitch` (registered below as an unmount cleanup, so a
 * user who leaves in that window isn't yanked back) would kill it. Radix
 * unmounts `DropdownMenuContent` on select — inside that very window — so a
 * cleanup registered in there would cancel every pick made through it. This
 * component is mounted by the header slot and stays mounted across every open
 * and close, which is why it owns the queries, the permission, the guard and
 * the timers, and `LocaleMenuItem` owns none of them.
 */
export function LocaleTitleChip({
    schema,
    entry,
    isCreate,
    mode,
    typePath,
    tabSegment,
    params
}: EntrySlotContext) {
    const intl = useIntl();
    const navigate = useNavigate();
    const location = useLocation();
    const guard = useUnsavedChangesApi();
    const canCreate = useHasPermission(CONTENT_CREATE);
    const {
        locales,
        defaultLocale,
        isPending: localesPending,
        isError: localesFailed,
        refetch: refetchConfiguredLocales
    } = useLocales();

    // The editor's own slot params, not `useSearchParams`: the entry-params
    // contribution already declares both keys, so this reads the values the
    // editor resolved rather than re-reading the URL beside it.
    const urlLocale = params[LOCALE_PARAM];
    const urlGroupId = params[LOCALE_GROUP_PARAM];

    // Edit mode lists the saved entry's group by its id; a create-into-group
    // (translation draft) reads the same members batched by the group id.
    const entryLocales = useEntryLocales(
        schema.name,
        entry?.id,
        !!schema.i18n && !isCreate && !!entry
    );
    // The menu's rows carry each locale's publish state, but they come from
    // this plugin's own query — which the content plugin's write mutations know
    // nothing about (they invalidate the content caches, not ours). So a save or
    // publish left the rows, and the chip's count, showing whatever they said
    // before it.
    //
    // The slot context's `entry` *is* refreshed by those mutations, so it is the
    // trigger. Keyed on **`updatedAt`, not `status`**: a write that leaves the
    // status where it was still changes the panel — saving twice in a row keeps
    // it `draft` both times, and editing a *shared* field rewrites the sibling
    // locales' rows without touching this one's status at all. `updatedAt` moves
    // on every write, so the rows can't go stale behind one.
    const entryUpdatedAt = entry?.updatedAt;
    const refetchLocales = entryLocales.refetch;
    useEffect(() => {
        if (!entryUpdatedAt) return;
        void refetchLocales();
    }, [entryUpdatedAt, refetchLocales]);

    const groupSummaries = useLocaleSummaries(
        schema.name,
        [urlGroupId],
        !!schema.i18n && isCreate && !!urlGroupId
    );

    // A pick schedules its navigation behind the cover. If the editor unmounts
    // in that window — the user clicked something else, which the overlay
    // deliberately lets through — the navigation is stale and must not fire.
    useEffect(() => cancelPendingLocaleSwitch, []);

    if (!schema.i18n) return null;

    const currentLocale = resolveActiveLocale({
        entryLocale: entry?.locale,
        urlLocale,
        defaultSlug: defaultLocale?.slug
    });
    if (!currentLocale) return null;

    const currentName = localeName(locales, currentLocale);
    const groupId = entry?.localeGroupId ?? urlGroupId;

    // The **configured** locale list: which locales exist at all.
    const localesState = readState({
        isPending: localesPending,
        isError: localesFailed
    });

    // The **group's members**: which of those locales this record exists in.
    //
    // An unfinished or failed group read leaves every locale resolving to
    // `undefined`, which renders as "no translation exists" — an invitation to
    // create a sibling that may already be there, whose save then 409s. Not-yet
    // and not-at-all are different answers and this menu has to say which one
    // it has (`i18n:I-30`).
    //
    // In create mode with no group there is genuinely nothing to read:
    // `useLocaleSummaries` reports itself idle rather than pending, so a fresh
    // create is `known` with no members — which is the truth.
    const membersState = readState(
        isCreate
            ? groupSummaries
            : {
                  isPending: entryLocales.isPending,
                  isError: entryLocales.isError
              }
    );
    const membersUnknown = membersState !== 'known';
    const entryItems = entryLocales.data?.items;

    // No extra request: edit mode already has one item per configured locale,
    // and create mode has the group's live members. `total` in create mode must
    // come from the **configured** list — a summary holds only live members, so
    // deriving it there would read `2/2` for a group missing two locales.
    const total = isCreate ? locales.length : (entryItems?.length ?? 0);
    const translated = isCreate
        ? groupId
            ? (groupSummaries.groups[groupId]?.length ?? 0)
            : 0
        : (entryItems?.filter((item) => !!item.entry).length ?? 0);
    // Withheld rather than guessed while the members are unknown: `0/4` on a
    // read that has not landed is the same lie the rows would tell
    // (`i18n:I-30`).
    const countKnown = !membersUnknown && total > 0;

    // The create route carries the target locale and — when translating into an
    // existing group — that group, so Save stamps the sibling. A fresh create
    // (no group) omits the group param entirely.
    const createSearch = (slug: string) => {
        const search = new URLSearchParams();
        search.set(LOCALE_PARAM, slug);
        if (groupId) search.set(LOCALE_GROUP_PARAM, groupId);
        return search.toString();
    };

    // The group's existing member in one locale (its id + status), or undefined.
    const siblingFor = (slug: string): Sibling | undefined => {
        if (isCreate) {
            const item = groupId
                ? groupSummaries.groups[groupId]?.find(
                      (member) => member.locale === slug
                  )
                : undefined;
            return item
                ? {
                      id: item.entryId,
                      status: item.status,
                      publishedAt: item.publishedAt
                  }
                : undefined;
        }
        const item = entryItems?.find(
            (candidate) => candidate.locale === slug
        );
        return item?.entry
            ? {
                  id: item.entry.id,
                  status: item.entry.status,
                  publishedAt: item.entry.publishedAt
              }
            : undefined;
    };

    const selectLocale = (slug: string, sibling?: Sibling) => {
        const name = localeName(locales, slug) ?? slug;
        // The draft's shared fields come from the source values: the saved
        // entry (edit mode), or whatever the create form already carries
        // (create mode — a translation draft's prefill), preserved as-is.
        // `translateFromLocale` rides with the values: the shared fields are
        // about to be copied verbatim into a row of a *different* locale, and
        // the destination editor has no other way to know what language they
        // are actually in (WCAG 3.1.2 — `ORT-87`).
        const state = isCreate
            ? location.state
            : {
                  translateFrom: entry?.values,
                  translateFromLocale: entry?.locale
              };
        // Play the switch flourish, then navigate **behind** the overlay once it
        // covers (see `beginLocaleSwitch`) so the editor doesn't visibly swap
        // under the blur. The module-level store carries the flourish across the
        // navigation so the destination editor's overlay host picks it up.
        beginLocaleSwitch(name, () => {
            if (mode === ENTRY_MODE.Single) {
                if (sibling) {
                    navigate(
                        isDefaultLocale(slug, defaultLocale?.slug)
                            ? `${typePath}${tabSegment}`
                            : `${typePath}${tabSegment}?${LOCALE_PARAM}=${slug}`
                    );
                } else {
                    navigate(`${typePath}${tabSegment}?${createSearch(slug)}`, {
                        state
                    });
                }
                return;
            }
            if (sibling) {
                navigate(`${typePath}/${sibling.id}${tabSegment}`);
            } else {
                navigate(`${typePath}/new${tabSegment}?${createSearch(slug)}`, {
                    state
                });
            }
        });
    };

    // Switch to an existing locale, or re-target the form to a missing one
    // (same group). A switch leaves this record for another, so anything
    // unsaved is gone. Routed through the **app-wide** guard rather than a
    // local dialog, so this prompt is the same one every other navigation
    // shows, and so it outlives the menu that started it — the guard's dialog
    // is rendered by `UnsavedChangesProvider` at app level. The guard no-ops
    // when nothing is dirty (#36).
    const requestLocale = (slug: string, sibling?: Sibling) => {
        const run = () => selectLocale(slug, sibling);
        if (guard) guard.confirmNavigation(run);
        else run();
    };

    return (
        // `modal={false}`, like every other menu in this admin: a modal Radix
        // menu `aria-hidden`s the page root, so the editor's own `<h1>` drops
        // out of the a11y tree while the menu is open.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                {/* A real `<button>`, not the `Badge` `<div>` this chip used to
                    be: Radix needs a control to hand its menu semantics and its
                    keyboard contract to. `badgeVariants` gives it the chip's
                    look with no design-system change. */}
                <button
                    type="button"
                    className={cn(
                        badgeVariants({ variant: 'outline' }),
                        'gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                    aria-label={
                        countKnown
                            ? intl.formatMessage(messages.trigger, {
                                  name: currentName ?? currentLocale,
                                  translated,
                                  total
                              })
                            : intl.formatMessage(messages.label, {
                                  name: currentName ?? currentLocale
                              })
                    }
                >
                    {currentLocale.toUpperCase()}
                    {/* The display name is written *in* that locale, so it
                        declares its own language and direction (`locale` is a
                        BCP-47 tag by contract). The uppercased code above is a
                        machine token and stays in the page's language.

                        The separator sits **outside** the marked span, in the
                        chip's own direction. Inside it, a right-to-left name
                        dragged the ` · ` to the wrong side of itself — the
                        separator belongs to the chip's layout, not to the name
                        (`ORT-86`). */}
                    {currentName ? (
                        <>
                            {' · '}
                            <span {...localeAttrs(locales, currentLocale)}>
                                {currentName}
                            </span>
                        </>
                    ) : null}
                    {countKnown ? (
                        <span className="font-normal text-muted-foreground">
                            {intl.formatMessage(messages.count, {
                                translated,
                                total
                            })}
                        </span>
                    ) : null}
                    <ChevronDown
                        aria-hidden
                        className="size-3 text-muted-foreground"
                    />
                </button>
            </DropdownMenuTrigger>
            {/* No `aria-label` here: Radix already points the menu's
                `aria-labelledby` at the trigger, which names it better than a
                bare "Locales" would — and `aria-labelledby` wins anyway, so one
                would only be dead markup. */}
            <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>
                    {intl.formatMessage(messages.heading)}
                </DropdownMenuLabel>
                {membersState === 'failed' ? (
                    <>
                        <DropdownMenuLabel className="font-normal text-destructive">
                            {intl.formatMessage(messages.loadFailed)}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            // Keep the menu open: the retry's whole point is
                            // that the rows below it fill in.
                            onSelect={(event) => {
                                event.preventDefault();
                                if (isCreate) groupSummaries.refetch();
                                else void entryLocales.refetch();
                            }}
                        >
                            {intl.formatMessage(messages.retry)}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                {localesState === 'pending' ? (
                    // Still loading. It must **not** borrow either of the two
                    // branches below: the entry read can resolve before
                    // `GET /api/i18n/locales` on a deep link into an editor, so
                    // claiming a failure here means the menu asserts a broken
                    // config, and offers a retry for it, while the request is
                    // still in flight.
                    <DropdownMenuLabel className="font-normal text-muted-foreground">
                        {intl.formatMessage(messages.localesPending)}
                    </DropdownMenuLabel>
                ) : locales.length === 0 ? (
                    // Nothing to choose from — but *why* is two different
                    // answers, and the retry is only honest about one of them.
                    // A locale dropped from the host config while rows in it
                    // still exist is a real state (see the i18n dossier), and
                    // reading it as "couldn't load" sends the reader looking
                    // for a network fault that isn't there.
                    <>
                        <DropdownMenuLabel
                            className={cn(
                                'font-normal',
                                localesState === 'failed'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {intl.formatMessage(
                                localesState === 'failed'
                                    ? messages.localesUnavailable
                                    : messages.localesNone
                            )}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                refetchConfiguredLocales();
                            }}
                        >
                            {intl.formatMessage(messages.localesRetry)}
                        </DropdownMenuItem>
                    </>
                ) : (
                    <DropdownMenuRadioGroup value={currentLocale}>
                        {locales.map((locale) => {
                            const sibling = siblingFor(locale.slug);
                            const isCurrent = locale.slug === currentLocale;
                            // Existing → switch (any role); missing → create
                            // (gated). Nothing is actionable while the members
                            // are unknown — **pending as much as failed**: an
                            // "Add" we cannot stand behind is worse than no
                            // affordance, and until the group read lands every
                            // sibling looks missing whether it is or not.
                            const actionable =
                                !isCurrent &&
                                !membersUnknown &&
                                (!!sibling || canCreate);
                            return (
                                <LocaleMenuItem
                                    key={locale.slug}
                                    slug={locale.slug}
                                    name={locale.name}
                                    nameAttrs={localeAttrs(
                                        locales,
                                        locale.slug
                                    )}
                                    isCurrent={isCurrent}
                                    exists={!!sibling}
                                    // Why a missing locale is inert, so the row
                                    // reads as a stated state rather than an
                                    // unexplained ghost. Unknown members
                                    // outrank permission — we genuinely don't
                                    // know whether it is missing — and the two
                                    // ways of not knowing are told apart,
                                    // because "couldn't load" on a read that is
                                    // merely still running is the same false
                                    // claim in a smaller place.
                                    inertReason={
                                        isCurrent || sibling
                                            ? undefined
                                            : membersState === 'pending'
                                              ? 'pending'
                                              : membersState === 'failed'
                                                ? 'unknown'
                                                : !canCreate
                                                  ? 'forbidden'
                                                  : undefined
                                    }
                                    // Publish state is **publishable-only**: an
                                    // always-live type has no publish workflow,
                                    // so a "Draft" chip beside a locale would
                                    // name a state the type doesn't have.
                                    status={
                                        schema.publishable
                                            ? sibling?.status
                                            : undefined
                                    }
                                    publishedAt={
                                        schema.publishable
                                            ? sibling?.publishedAt
                                            : undefined
                                    }
                                    onSelect={
                                        actionable
                                            ? () =>
                                                  requestLocale(
                                                      locale.slug,
                                                      sibling
                                                  )
                                            : undefined
                                    }
                                />
                            );
                        })}
                    </DropdownMenuRadioGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
