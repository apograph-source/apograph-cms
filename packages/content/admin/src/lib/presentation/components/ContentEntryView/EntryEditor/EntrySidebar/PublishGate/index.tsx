import { defineMessages, useIntl } from 'react-intl';
import { Check, X } from 'lucide-react';
import { cn } from '@ortha/design-system';
import { EntrySidebarSection } from '../../../../EntrySidebarSection';

/** One row of the publish gate: a field check with its live pass/fail. */
export type PublishGateItem = {
    /** The field's display label. */
    label: string;
    /** Whether the field currently passes publish validation. */
    ok: boolean;
    /** The failure message when `ok` is false. */
    message?: string;
};

const messages = defineMessages({
    gateTitle: {
        id: 'content.sidebar.gateTitle',
        defaultMessage: 'Publish gate'
    },
    saveGateTitle: {
        id: 'content.sidebar.saveGateTitle',
        defaultMessage: 'Save gate'
    },
    gateEmpty: {
        id: 'content.sidebar.gateEmpty',
        defaultMessage: 'Nothing is required on this type.'
    },
    gateDraftCaption: {
        id: 'content.sidebar.gateDraftCaption',
        defaultMessage:
            'These are the checks to publish. Saving a draft doesn’t need them — an incomplete draft saves fine.'
    },
    gateBlocking: {
        id: 'content.sidebar.gateBlocking',
        defaultMessage: 'blocking'
    },
    gateReady: { id: 'content.sidebar.gateReady', defaultMessage: 'ready' },
    gateFailing: {
        id: 'content.sidebar.gateFailing',
        defaultMessage: 'failing'
    },
    gatePasses: {
        id: 'content.sidebar.gatePasses',
        defaultMessage: 'Passes:'
    },
    gateNeedsAttention: {
        id: 'content.sidebar.gateNeedsAttention',
        defaultMessage: 'Needs attention:'
    },
    gateAllClear: {
        id: 'content.sidebar.gateAllClear',
        defaultMessage: 'Every check passes — ready to publish.'
    },
    gateAllClearSave: {
        id: 'content.sidebar.gateAllClearSave',
        defaultMessage: 'Every check passes — ready to save.'
    },
    gateCaption: {
        id: 'content.sidebar.gateCaption',
        defaultMessage:
            'Checks re-run on every change — fix a field and watch it flip.'
    }
});

/**
 * The live requirement gate in the entry editor's right rail: the strict
 * validation field by field, each with its pass/fail, and a header that reads
 * `blocking`/`ready`. Presentational — the parent owns the `items`.
 *
 * It shows on **every** type, but means different things on each, so it says
 * which it is. On a **publishable** type it is the *publish* gate: a draft save
 * is deliberately permissive, so the caption spells out that an incomplete
 * draft still saves — otherwise a red "blocking" beside a button that saves
 * happily would read as a contradiction. On an always-live type Save *is*
 * strict, so the gate is simply the save requirements.
 */
export function PublishGate({
    items,
    publishable
}: {
    items: PublishGateItem[];
    /** Whether the type has a publish workflow — decides the section's meaning. */
    publishable: boolean;
}) {
    const intl = useIntl();
    const blocking = items.some((item) => !item.ok);

    return (
        <EntrySidebarSection
            title={intl.formatMessage(
                publishable ? messages.gateTitle : messages.saveGateTitle
            )}
            action={
                <span
                    className={cn(
                        'text-xs font-medium',
                        blocking ? 'text-destructive' : 'text-muted-foreground'
                    )}
                >
                    {intl.formatMessage(
                        blocking ? messages.gateBlocking : messages.gateReady
                    )}
                </span>
            }
        >
            <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(
                            publishable
                                ? messages.gateAllClear
                                : messages.gateAllClearSave
                        )}
                    </p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {items.map((item, index) => (
                            <li
                                // `label` alone collides when two fields share
                                // an `admin.label`; the index disambiguates the
                                // pair without changing the render order.
                                key={`${item.label}-${index}`}
                                className="flex items-start gap-2 text-sm"
                            >
                                {item.ok ? (
                                    <Check
                                        className="mt-0.5 size-4 shrink-0 text-primary"
                                        aria-hidden
                                    />
                                ) : (
                                    <X
                                        className="mt-0.5 size-4 shrink-0 text-destructive"
                                        aria-hidden
                                    />
                                )}
                                {/* Pass/fail was carried by the icon (which is
                                    `aria-hidden`) and its colour alone, so a
                                    passing row read as a bare field label — one
                                    more outstanding item, to a screen reader,
                                    and indistinguishable under Windows High
                                    Contrast (WCAG 1.4.1, 1.3.1). State it in
                                    words, first, for assistive tech only. */}
                                <span className="sr-only">
                                    {intl.formatMessage(
                                        item.ok
                                            ? messages.gatePasses
                                            : messages.gateNeedsAttention
                                    )}
                                </span>
                                <span className="min-w-0 flex-1">
                                    {item.label}
                                </span>
                                {!item.ok && (
                                    <span className="shrink-0 text-xs text-destructive">
                                        {item.message ??
                                            intl.formatMessage(
                                                messages.gateFailing
                                            )}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                    {intl.formatMessage(
                        publishable
                            ? messages.gateDraftCaption
                            : messages.gateCaption
                    )}
                </p>
            </div>
        </EntrySidebarSection>
    );
}
