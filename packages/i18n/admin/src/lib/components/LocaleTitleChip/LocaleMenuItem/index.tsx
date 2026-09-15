import { defineMessages, useIntl } from 'react-intl';
import { Plus } from 'lucide-react';
import { DropdownMenuRadioItem, cn } from '@apograph/design-system';
import { EntryStatusBadge, type EntryStatus } from '@apograph/content-admin';

const messages = defineMessages({
    add: { id: 'i18n.widget.add', defaultMessage: 'Add' },
    switchLabel: {
        id: 'i18n.widget.switchLabel',
        defaultMessage: 'Switch to the {name} version'
    },
    addLabel: {
        id: 'i18n.widget.addLabel',
        defaultMessage: 'Create the {name} translation'
    },
    forbidden: {
        id: 'i18n.widget.forbiddenReason',
        defaultMessage: 'Not translated — you can’t create translations'
    },
    unknown: {
        id: 'i18n.widget.unknownReason',
        defaultMessage: 'Unknown — couldn’t load'
    },
    pending: {
        id: 'i18n.widget.pendingReason',
        defaultMessage: 'Checking…'
    }
});

/**
 * Why a non-current locale's row carries no action.
 *
 * `pending` and `unknown` are **both** "we do not know whether a translation
 * exists", and are separate because only one of them is a fault: saying
 * "couldn't load" about a read that is still running sends the reader after a
 * problem that isn't there.
 */
export type LocaleMenuItemInertReason = 'forbidden' | 'unknown' | 'pending';

/** The stated reason for each way a row can be inert. */
const REASON_LABEL: Record<
    LocaleMenuItemInertReason,
    (typeof messages)[keyof typeof messages]
> = {
    forbidden: messages.forbidden,
    unknown: messages.unknown,
    pending: messages.pending
};

/**
 * One locale in the title chip's menu. The current locale is the **checked**
 * radio item; an **existing** sibling is a switch target (with its publish
 * status); a **missing** locale re-targets the form to it.
 *
 * **Purely presentational, and deliberately so.** This is the only thing
 * rendered inside `DropdownMenuContent`, which Radix unmounts the moment an
 * item is selected — while the switch it just started is still waiting out the
 * cover delay. So it owns no query, no timer, and above all **no unmount
 * cleanup**: `cancelPendingLocaleSwitch` here would cancel the very pick that
 * unmounted it. All of that lives in `LocaleTitleChip`, which stays mounted.
 *
 * An inert row **states why**, and is `aria-disabled` rather than `disabled`:
 * Radix skips a `disabled` item in arrow navigation, so the reason would be
 * unreachable for exactly the keyboard user who needs it. `onSelect` is
 * `preventDefault`ed instead, which also leaves the menu open.
 */
export function LocaleMenuItem({
    slug,
    name,
    nameAttrs,
    isCurrent,
    exists,
    status,
    publishedAt,
    inertReason,
    onSelect
}: {
    /** The locale's slug — the radio group's value for this row. */
    slug: string;
    /** Display name of the locale. */
    name: string;
    /**
     * `lang`/`dir` for the name — it is written *in* the locale it names, so a
     * screen reader needs its language to pronounce it (WCAG 3.1.2) and an RTL
     * name needs its direction to order correctly.
     */
    nameAttrs?: { lang?: string; dir?: 'ltr' | 'rtl' };
    /** Whether this is the locale the editor currently has open. */
    isCurrent: boolean;
    /** Whether a translation exists in this locale. */
    exists: boolean;
    /** The sibling row's publish status (publishable types only). */
    status?: EntryStatus;
    /**
     * When that row last went live, or `null` — publishable types only. Read
     * with `status` by the shared classifier, so a locale carrying unpublished
     * edits over live content reads **Modified** instead of a bare "Draft".
     */
    publishedAt?: string | null;
    /** Why this row is inert, when it is. Rendered as the row's state. */
    inertReason?: LocaleMenuItemInertReason;
    /** Switch to / create this locale. Absent = not actionable. */
    onSelect?: () => void;
}) {
    const intl = useIntl();
    const missing = !exists && !isCurrent;
    const inert = !!inertReason;
    const actionable = !!onSelect && !isCurrent && !inert;

    return (
        <DropdownMenuRadioItem
            value={slug}
            // The visible row carries a status badge and an "Add" hint, which
            // would join the accessible name as loose words. An actionable row
            // states what selecting it does instead.
            aria-label={
                actionable
                    ? intl.formatMessage(
                          exists ? messages.switchLabel : messages.addLabel,
                          { name }
                      )
                    : undefined
            }
            aria-disabled={inert || undefined}
            className="gap-2"
            onSelect={(event) => {
                if (!actionable) {
                    // Keep the menu open: nothing happened, and closing it
                    // would read as the pick having been taken.
                    if (inert) event.preventDefault();
                    return;
                }
                onSelect?.();
            }}
        >
            <span
                className={cn(
                    'min-w-0 flex-1 truncate',
                    missing && 'text-muted-foreground'
                )}
                {...nameAttrs}
            >
                {name}
            </span>
            <span className="flex shrink-0 items-center gap-2">
                {status ? (
                    // `explainModified={false}`: this row **is** a control, and
                    // Modified's tooltip trigger is a `<button>` — nesting one
                    // inside a menu item is `nested-interactive`, a serious
                    // WCAG failure the row's own axe scan catches.
                    <EntryStatusBadge
                        entry={{ status, publishedAt }}
                        explainModified={false}
                    />
                ) : null}
                {missing && actionable ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Plus aria-hidden className="size-3" />
                        {intl.formatMessage(messages.add)}
                    </span>
                ) : null}
                {inertReason ? (
                    // Real text at full contrast, never `opacity-50` — halving
                    // the muted token measured 2.18:1, below AA, and said
                    // nothing about *why* the row was inert.
                    <span className="text-xs text-muted-foreground">
                        {intl.formatMessage(REASON_LABEL[inertReason])}
                    </span>
                ) : null}
            </span>
        </DropdownMenuRadioItem>
    );
}
