import { defineMessages, useIntl } from 'react-intl';
import { X } from 'lucide-react';
import { cn } from '@apograph/design-system';
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
    gateDraftCaption: {
        id: 'content.sidebar.gateDraftCaption',
        defaultMessage:
            'These are the checks to publish. Saving a draft doesn’t need them — an incomplete draft saves fine.'
    },
    gateBlockingCount: {
        id: 'content.sidebar.gateBlockingCount',
        defaultMessage: '{n, plural, one {# blocking} other {# blocking}}'
    },
    gateReady: { id: 'content.sidebar.gateReady', defaultMessage: 'ready' },
    gateFailing: {
        id: 'content.sidebar.gateFailing',
        defaultMessage: 'failing'
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
 * The live requirement gate in the entry editor's right rail. Presentational —
 * the parent owns the `items`, and this component decides only **how many** of
 * them are failing and how to draw that, never *what* fails (`content:I-38`:
 * validation and the publication gate exist in one copy, in the kernel).
 *
 * It renders the **failing checks only**. The passing ones were a list of every
 * required field on the type, re-stated on every render of a record that had
 * nothing wrong with it — pages of green ticks the reader had to scan to find
 * the one red line. With nothing failing there is one sentence instead; the
 * moment something blocks, the list is exactly the work outstanding and the
 * heading counts it.
 *
 * This is **not** a collapsible section and must not become one: what it shows
 * is decided by the verdict, not by the reader, so there is no control and no
 * remembered state to get out of step with the record.
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
    // The all-clear branch is "nothing is failing", **not** "there is nothing
    // to check": a type whose every required field is filled is as ready as a
    // type with no requirements at all, and the reader is owed the same
    // sentence for both.
    const failing = items.filter((item) => !item.ok);
    const blocking = failing.length > 0;

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
                    {blocking
                        ? intl.formatMessage(messages.gateBlockingCount, {
                              n: failing.length
                          })
                        : intl.formatMessage(messages.gateReady)}
                </span>
            }
        >
            <div className="flex flex-col gap-2">
                {blocking ? (
                    <ul className="flex flex-col gap-2">
                        {failing.map((item, index) => (
                            <li
                                // `label` alone collides when two fields share
                                // an `admin.label`; the index disambiguates the
                                // pair without changing the render order.
                                key={`${item.label}-${index}`}
                                className="flex items-start gap-2 text-sm"
                            >
                                <X
                                    className="mt-0.5 size-4 shrink-0 text-destructive"
                                    aria-hidden
                                />
                                {/* The failure was carried by the icon (which
                                    is `aria-hidden`) and its colour alone, so a
                                    row read as a bare field label — and was
                                    indistinguishable under Windows High
                                    Contrast (WCAG 1.4.1, 1.3.1). State it in
                                    words, first, for assistive tech only. */}
                                <span className="sr-only">
                                    {intl.formatMessage(
                                        messages.gateNeedsAttention
                                    )}
                                </span>
                                <span className="min-w-0 flex-1">
                                    {item.label}
                                </span>
                                <span className="shrink-0 text-xs text-destructive">
                                    {item.message ??
                                        intl.formatMessage(messages.gateFailing)}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(
                            publishable
                                ? messages.gateAllClear
                                : messages.gateAllClearSave
                        )}
                    </p>
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
