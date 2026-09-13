import { defineMessages, useIntl } from 'react-intl';
import { Check, Plus } from 'lucide-react';
import { cn } from '@apograph/design-system';
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
    }
});

/** Why a non-current locale's row carries no action. */
export type LocaleRowInertReason = 'forbidden' | 'unknown';

/**
 * One locale's row in the {@link LocaleWidget} switcher. The current locale is
 * marked; an **existing** sibling is a switch target (with its publish status);
 * a **missing** locale is selectable to re-target the form to it.
 * The whole row is the switch affordance — a single `<button>` when actionable,
 * otherwise a static (current) or inert (no permission / unknown) row.
 *
 * An inert row **states why**. It used to be the actionable row at
 * `opacity-50`, which is a token chosen to just clear 4.5:1 and then halved —
 * measured at 2.18:1 against the rail, below AA — and it carried no text, so a
 * *forbidden* locale and a *missing* one were the same dim line with no
 * programmatic difference. The reason is real text at full contrast instead.
 */
export function LocaleRow({
    name,
    nameAttrs,
    isCurrent,
    exists,
    status,
    publishedAt,
    inertReason,
    onSelect
}: {
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
    inertReason?: LocaleRowInertReason;
    /** Switch to / create this locale. Absent = not actionable. */
    onSelect?: () => void;
}) {
    const intl = useIntl();
    const missing = !exists && !isCurrent;

    const body = (
        <>
            <span
                className={cn(
                    'flex min-w-0 items-center gap-2',
                    missing && 'text-muted-foreground'
                )}
            >
                {isCurrent ? (
                    <Check aria-hidden className="size-3.5 shrink-0" />
                ) : (
                    <span aria-hidden className="size-3.5 shrink-0" />
                )}
                <span className="truncate" {...nameAttrs}>
                    {name}
                </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
                {status ? (
                    <EntryStatusBadge entry={{ status, publishedAt }} />
                ) : null}
                {missing && onSelect ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Plus aria-hidden className="size-3" />
                        {intl.formatMessage(messages.add)}
                    </span>
                ) : null}
                {inertReason ? (
                    <span className="text-xs text-muted-foreground">
                        {intl.formatMessage(
                            inertReason === 'forbidden'
                                ? messages.forbidden
                                : messages.unknown
                        )}
                    </span>
                ) : null}
            </span>
        </>
    );

    const rowClass =
        'flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-sm';

    // Actionable rows are a single full-width button (the whole row switches).
    if (onSelect && !isCurrent) {
        return (
            <li>
                <button
                    type="button"
                    onClick={onSelect}
                    aria-label={intl.formatMessage(
                        exists ? messages.switchLabel : messages.addLabel,
                        { name }
                    )}
                    className={cn(
                        rowClass,
                        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                >
                    {body}
                </button>
            </li>
        );
    }

    // Current (highlighted) or inert (no create permission / unknown members).
    // No `opacity-50`: it dropped the muted token to 2.18:1 — below AA — and
    // said nothing about *why* the row was inert. The reason is real text
    // instead, which is also what carries the state to a screen reader; there
    // is no control here to mark `aria-disabled`, and the attribute is not
    // supported on a `listitem` anyway.
    return (
        <li
            aria-current={isCurrent ? 'true' : undefined}
            className={cn(rowClass, isCurrent && 'bg-accent')}
        >
            {body}
        </li>
    );
}
